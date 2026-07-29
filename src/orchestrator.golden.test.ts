import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A recorded, real run of the full pipeline — "4 days in Meghalaya, BDT
 * 45,000", Story 1's own headline example — captured after the date-arithmetic
 * fix. Not re-run here: this asserts STRUCTURAL properties of the frozen
 * output, never exact content (brief_summary, soft_notes wording, etc. vary
 * run to run). This is the regression guard for Phase 1's refactor of the
 * entry point — a future HTTP/SSE wrapper around orchestrator.ts should still
 * produce output with all of these same properties.
 *
 * Notably, this particular recording exercised a real revision round: the
 * first Itinerary attempt hit one hard failure, got revised, and passed on
 * the second Critic pass — not just the trivial zero-revision happy path.
 */
const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "__fixtures__/golden-meghalaya-run.json"), "utf-8"),
);

function activityKey(ref: { osm_type: string; osm_id: number }): string {
  return `${ref.osm_type}/${ref.osm_id}`;
}

describe("golden run — 4 days in Meghalaya, BDT 45,000 (recorded, never re-run live)", () => {
  it("emits the expected stage sequence, including the revision round this run actually took", () => {
    const sequence = fixture.events.map((e: { stage: string; status: string }) => `${e.stage}:${e.status}`);
    expect(sequence).toEqual([
      "intake:started",
      "intake:completed",
      "guide:started",
      "guide:completed",
      "itinerary:started",
      "itinerary:completed",
      "critic:started",
      "critic:completed",
      "itinerary:started",
      "itinerary:completed",
      "critic:started",
      "critic:completed",
    ]);
  });

  it("every scheduled activity traces back to a real Destination candidate — no fabrication", () => {
    const knownKeys = new Set(
      fixture.destinations.flatMap((d: { activities: { osm_type: string; osm_id: number }[] }) =>
        d.activities.map(activityKey),
      ),
    );
    const scheduledKeys = fixture.itinerary.days.flatMap((day: { stops: { activity: { osm_type: string; osm_id: number } }[] }) =>
      day.stops.map((s) => activityKey(s.activity)),
    );

    expect(scheduledKeys.length).toBeGreaterThan(0);
    for (const key of scheduledKeys) {
      expect(knownKeys.has(key)).toBe(true);
    }
  });

  it("never schedules the same activity twice across the trip", () => {
    const scheduledKeys = fixture.itinerary.days.flatMap((day: { stops: { activity: { osm_type: string; osm_id: number } }[] }) =>
      day.stops.map((s) => activityKey(s.activity)),
    );
    expect(new Set(scheduledKeys).size).toBe(scheduledKeys.length);
  });

  it("marks dates provisional — no dates were given in the request", () => {
    expect(fixture.itinerary.dates_provisional).toBe(true);
  });

  it("marks cost fields null and the total incomplete — no lodging/transport tool exists yet", () => {
    expect(fixture.itinerary.flights_cost_usd).toBeNull();
    for (const day of fixture.itinerary.days) {
      expect(day.lodging_cost_usd).toBeNull();
    }
    expect(fixture.itinerary.estimated_total_complete).toBe(false);
  });

  it("reaches a pass verdict with no outstanding hard failures", () => {
    expect(fixture.critique.verdict).toBe("pass");
    expect(fixture.critique.hard_failures).toEqual([]);
  });

  it("schedules each day's stops in non-overlapping chronological order", () => {
    for (const day of fixture.itinerary.days) {
      for (let i = 1; i < day.stops.length; i++) {
        expect(day.stops[i].start >= day.stops[i - 1].end).toBe(true);
      }
    }
  });
});
