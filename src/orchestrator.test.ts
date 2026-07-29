import { describe, expect, it } from "vitest";
import { decideNextStep, mapWithConcurrency } from "./orchestrator.js";
import { LIMITS } from "./config.js";
import type { CritiqueResult } from "./schemas/index.js";

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
