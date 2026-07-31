import { describe, expect, it } from "vitest";
import { makeRunBlockedEvent, makeRunStartedEvent, makeRunSucceededEvent, projectProgressEvent } from "./run-events.js";
import type { PipelineResult, ProgressEvent } from "../orchestrator.js";

const RUN_ID = "90d8f990-4bc7-4339-a481-70f56f5a4d77";

describe("run event projection", () => {
  it("projects stage progress with structured revision metadata", () => {
    const progress: ProgressEvent = {
      stage: "critic",
      status: "completed",
      message: "Verdict: pass",
      revisionRound: 1,
    };
    const event = projectProgressEvent({ runId: RUN_ID, nextSeq: 7 }, progress);
    expect(event.kind).toBe("stage_progress");
    if (event.kind !== "stage_progress") return;
    expect(event.revision_round).toBe(1);
    expect(event.seq).toBe(7);
  });

  it("projects guide destination updates to destination_progress with index and total", () => {
    const progress: ProgressEvent = {
      stage: "guide",
      status: "failed",
      destination: "Meghalaya",
      destinationIndex: 1,
      destinationTotal: 3,
      message: "Could not research Meghalaya",
    };
    const event = projectProgressEvent({ runId: RUN_ID, nextSeq: 3 }, progress);
    expect(event.kind).toBe("destination_progress");
    if (event.kind !== "destination_progress") return;
    expect(event.destination).toBe("Meghalaya");
    expect(event.index).toBe(1);
    expect(event.total).toBe(3);
    expect(event.stage).toBe("guide");
  });

  it("creates run_started with seq 0", () => {
    const event = makeRunStartedEvent({ runId: RUN_ID, nextSeq: 0 }, "4 days in Meghalaya", "2026-07-31");
    expect(event.kind).toBe("run_started");
    expect(event.seq).toBe(0);
  });

  it("creates run_blocked with open questions", () => {
    const event = makeRunBlockedEvent({ runId: RUN_ID, nextSeq: 12 }, "Missing trip length", [
      "How many nights is the trip?",
    ]);
    expect(event.kind).toBe("run_blocked");
    if (event.kind !== "run_blocked") return;
    expect(event.open_questions.length).toBe(1);
  });

  it("creates run_succeeded with inline payload", () => {
    const result = {
      brief: {
        origin: null,
        destinations: ["Meghalaya"],
        region_hint: null,
        date_expression: null,
        start_date: "2026-08-01",
        end_date: null,
        nights: 3,
        flexible_dates: false,
        travellers: { count: 1, adults: 1, children: 0 },
        budget_amount: 1000,
        budget_currency: "USD",
        budget_includes_flights: false,
        pace: "moderate",
        interests: [],
        dietary: [],
        mobility_needs: [],
        visa_constraints: [],
        must_include: [],
        must_avoid: [],
        open_questions: [],
      },
      destinations: [],
      itinerary: {
        brief_summary: "summary",
        days: [
          {
            date: "2026-08-01",
            base_city: "Shillong",
            stops: [],
            lodging_cost_usd: null,
            notes: null,
          },
        ],
        flights_cost_usd: null,
        estimated_total_usd: 0,
        estimated_total_complete: false,
        dates_provisional: false,
        construction_notes: [],
      },
      critique: {
        verdict: "pass",
        hard_failures: [],
        soft_notes: [],
        suggested_fixes: [],
      },
      revisionsUsed: 0,
    } satisfies PipelineResult;

    const event = makeRunSucceededEvent({ runId: RUN_ID, nextSeq: 99 }, result);
    expect(event.kind).toBe("run_succeeded");
    if (event.kind !== "run_succeeded") return;
    expect(event.payload.revisions_used).toBe(0);
  });
});
