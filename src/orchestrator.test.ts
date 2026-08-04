import { describe, expect, it } from "vitest";
import { decideNextStep, mapWithConcurrency, runWriterStage, type ProgressEvent } from "./orchestrator.js";
import { LIMITS } from "./config.js";
import type { CritiqueResult, Itinerary, TripBrief, WriterOutput } from "./schemas/index.js";

function makeCritique(overrides: Partial<CritiqueResult> = {}): CritiqueResult {
  return {
    verdict: "revise",
    hard_failures: [{ code: "OVER_BUDGET", message: "test" }],
    soft_notes: [],
    suggested_fixes: [],
    ...overrides,
  };
}

describe("decideNextStep", () => {
  it("passes through immediately when the verdict is already pass", () => {
    const critique = makeCritique({ verdict: "pass", hard_failures: [] });
    const decision = decideNextStep(critique, 0);
    expect(decision.action).toBe("pass");
    expect(decision.critique).toBe(critique);
  });

  it("allows a revision when under the cap", () => {
    const critique = makeCritique();
    const decision = decideNextStep(critique, LIMITS.maxRevisionRounds - 1);
    expect(decision.action).toBe("revise");
    expect(decision.critique.verdict).toBe("revise");
  });

  it("relabels to infeasible once the revision cap is reached, never the model's call", () => {
    const critique = makeCritique();
    const decision = decideNextStep(critique, LIMITS.maxRevisionRounds);
    expect(decision.action).toBe("infeasible");
    expect(decision.critique.verdict).toBe("infeasible");
    // The outstanding failures ride along — infeasible is a terminal state
    // carrying them, not a verdict that discards them.
    expect(decision.critique.hard_failures).toEqual(critique.hard_failures);
  });

  it("never allows more revisions than LIMITS.maxRevisionRounds, however large revisionsUsed gets", () => {
    const critique = makeCritique();
    const decision = decideNextStep(critique, LIMITS.maxRevisionRounds + 5);
    expect(decision.action).toBe("infeasible");
  });
});

describe("runWriterStage", () => {
  const itinerary = { brief_summary: "test trip" } as unknown as Itinerary;
  const brief = { travellers: { count: 2 } } as unknown as TripBrief;
  const prose = { title: "A Trip", summary: "s", sections: [], practical_tips: [] } as unknown as WriterOutput;

  function collector() {
    const events: ProgressEvent[] = [];
    return { events, emit: (e: ProgressEvent) => void events.push(e) };
  }

  // Gate: prose is only ever written for a `pass`. The Writer is told every
  // fact it receives is validated — untrue of an itinerary that failed its
  // hard checks, so it must not run at all.
  for (const verdict of ["infeasible", "revise"] as const) {
    it(`does not call the Writer when the verdict is ${verdict}, and emits no writer event`, async () => {
      const { events, emit } = collector();
      let called = 0;
      const result = await runWriterStage(
        { itinerary, brief, critique: makeCritique({ verdict }) },
        emit,
        async () => {
          called++;
          return prose;
        },
      );

      expect(called).toBe(0);
      expect(result).toBeNull();
      expect(events).toEqual([]);
    });
  }

  it("calls the Writer on a pass and returns its prose", async () => {
    const { events, emit } = collector();
    const critique = makeCritique({ verdict: "pass", hard_failures: [] });

    const result = await runWriterStage({ itinerary, brief, critique }, emit, async () => prose);

    expect(result).toBe(prose);
    expect(events.map((e) => e.status)).toEqual(["started", "completed"]);
    expect(events.every((e) => e.stage === "writer")).toBe(true);
  });

  it("forwards the Critic's soft notes, so advisory notes can reach the prose", async () => {
    const { emit } = collector();
    const critique = makeCritique({ verdict: "pass", hard_failures: [], soft_notes: ["monsoon season"] });
    let received: string[] | undefined;

    await runWriterStage({ itinerary, brief, critique }, emit, async (input) => {
      received = input.softNotes;
      return prose;
    });

    expect(received).toEqual(["monsoon season"]);
  });

  // Swallow-on-error: prose is presentational and last. Losing it must never
  // turn a validated Itinerary into a failed run, and must not change the
  // terminal state — which is keyed off critique.verdict, not off prose.
  it("swallows a Writer failure: resolves to null, does not reject, and leaves the verdict untouched", async () => {
    const { events, emit } = collector();
    const critique = makeCritique({ verdict: "pass", hard_failures: [] });

    const result = await runWriterStage({ itinerary, brief, critique }, emit, async () => {
      throw new Error("schema validation failed after 3 retries");
    });

    expect(result).toBeNull();
    expect(critique.verdict).toBe("pass");

    const failure = events.find((e) => e.status === "failed");
    expect(failure?.stage).toBe("writer");
    // The real cause has to survive into the event, or a Writer outage is
    // invisible in the logs — the run still looks entirely successful.
    expect(failure?.message).toContain("schema validation failed after 3 retries");
  });

  it("does not rethrow even when the Writer rejects with a non-Error value", async () => {
    const { events, emit } = collector();
    const critique = makeCritique({ verdict: "pass", hard_failures: [] });

    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    const result = await runWriterStage({ itinerary, brief, critique }, emit, async () => {
      throw "string rejection";
    });

    expect(result).toBeNull();
    expect(events.some((e) => e.status === "failed")).toBe(true);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const result = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` at once", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("resolves a failing item to null and continues the rest, rather than aborting", async () => {
    const items = ["ok", "boom", "ok2"];
    const errors: string[] = [];
    const result = await mapWithConcurrency(
      items,
      2,
      async (item) => {
        if (item === "boom") throw new Error("failed");
        return item.toUpperCase();
      },
      (item) => errors.push(item),
    );
    expect(result).toEqual(["OK", null, "OK2"]);
    expect(errors).toEqual(["boom"]);
  });

  it("handles an empty item list without dividing by zero or hanging", async () => {
    const result = await mapWithConcurrency([], 4, async (i) => i);
    expect(result).toEqual([]);
  });

  it("handles limit larger than the item count", async () => {
    const result = await mapWithConcurrency([1, 2], 10, async (i) => i * 2);
    expect(result).toEqual([2, 4]);
  });
});
