import { describe, expect, it } from "vitest";
import type { Activity, CritiqueResult, DayPlan, Itinerary, ScheduledStop } from "../schemas/index.js";
import { formatItineraryPretty } from "./pretty.js";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "a1",
    name: "Test Activity",
    location: { lat: 25.28, lng: 91.73 },
    address: null,
    category: "attraction",
    duration_minutes: 60,
    cost_usd_per_person: 5,
    opens: null,
    closes: null,
    closed_days: [],
    booking_required: false,
    notes: null,
    osm_type: "node",
    osm_id: 1,
    estimated: { duration: true, cost: true, hours: true },
    ...overrides,
  };
}

function makeStop(overrides: Partial<ScheduledStop> = {}): ScheduledStop {
  return {
    activity: makeActivity(),
    start: "09:00",
    end: "10:00",
    transit_minutes_from_previous: 0,
    transit_source: "heuristic",
    ...overrides,
  };
}

function makeDay(stops: ScheduledStop[], overrides: Partial<DayPlan> = {}): DayPlan {
  return { date: "2026-07-27", base_city: "Sohra", stops, lodging_cost_usd: null, notes: null, ...overrides };
}

function makeItinerary(days: DayPlan[], overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    brief_summary: "test summary",
    days,
    flights_cost_usd: null,
    estimated_total_usd: 0,
    estimated_total_complete: true,
    dates_provisional: false,
    construction_notes: [],
    ...overrides,
  };
}

function makeCritique(overrides: Partial<CritiqueResult> = {}): CritiqueResult {
  return { verdict: "pass", hard_failures: [], soft_notes: [], suggested_fixes: [], ...overrides };
}

describe("formatItineraryPretty", () => {
  it("accumulates a running total across per-person activity cost times traveller count", () => {
    const days = [
      makeDay([
        makeStop({ activity: makeActivity({ cost_usd_per_person: 10 }) }),
        makeStop({ activity: makeActivity({ cost_usd_per_person: 5 }), transit_minutes_from_previous: 15 }),
      ]),
    ];
    const itinerary = makeItinerary(days, { estimated_total_usd: 30, estimated_total_complete: true });

    const output = formatItineraryPretty(itinerary, makeCritique(), 2, 0);

    expect(output).toContain("running total: $20.00");
    expect(output).toContain("running total: $30.00");
    expect(output).toContain("Estimated total: $30.00");
    expect(output).not.toContain("partial");
  });

  it("includes lodging in the running total only when priced, and flags it otherwise", () => {
    const days = [makeDay([makeStop()], { lodging_cost_usd: 20 }), makeDay([makeStop()], { lodging_cost_usd: null })];
    const itinerary = makeItinerary(days, { estimated_total_usd: 30, estimated_total_complete: false });

    const output = formatItineraryPretty(itinerary, makeCritique(), 1, 0);

    expect(output).toContain("Lodging: $20.00");
    expect(output).toContain("Lodging: not priced yet");
    expect(output).toContain("Estimated total: $30.00 (partial — some costs not priced yet)");
  });

  it("marks dates provisional and surfaces transit source per stop", () => {
    const days = [makeDay([makeStop({ transit_source: "routed", transit_minutes_from_previous: 12 })])];
    const itinerary = makeItinerary(days, { dates_provisional: true });

    const output = formatItineraryPretty(itinerary, makeCritique(), 1, 0);

    expect(output).toContain("2026-07-27 (provisional)");
    expect(output).toContain("12 min transit (routed)");
  });

  it("renders the first stop of a day without a transit line", () => {
    const days = [makeDay([makeStop({ transit_minutes_from_previous: 0 })])];
    const output = formatItineraryPretty(makeItinerary(days), makeCritique(), 1, 0);

    expect(output).toContain("first stop");
  });

  it("prints hard failures, soft notes, and suggested fixes from the critique", () => {
    const days = [makeDay([makeStop()])];
    const critique = makeCritique({
      verdict: "revise",
      hard_failures: [{ code: "OVER_BUDGET", message: "Over budget by $10." }],
      soft_notes: ["Day 1 is dull."],
      suggested_fixes: ["Add an evening activity."],
    });

    const output = formatItineraryPretty(makeItinerary(days), critique, 1, 1);

    expect(output).toContain("Critic verdict: revise (1 revision round(s) used)");
    expect(output).toContain("[OVER_BUDGET] Over budget by $10.");
    expect(output).toContain("Day 1 is dull.");
    expect(output).toContain("Add an evening activity.");
  });
});
