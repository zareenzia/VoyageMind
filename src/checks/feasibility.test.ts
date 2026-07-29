import { describe, expect, it } from "vitest";
import {
  checkBudget,
  checkDay,
  checkItinerary,
  DEFAULT_LIMITS,
  estimateTransitMinutes,
  GRADE_THRESHOLDS_M_PER_KM,
  haversineKm,
  MIN_TRANSIT_MINUTES,
  TERRAIN_SPEED_KMH,
} from "./feasibility.js";
import type { Activity, DayPlan, Itinerary, ScheduledStop, TripBrief } from "../schemas/index.js";

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

function makeDay(stops: ScheduledStop[], date = "2026-07-27"): DayPlan {
  return { date, base_city: "Sohra", stops, lodging_cost_usd: 0, notes: null };
}

function makeItinerary(days: DayPlan[], overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    brief_summary: "test",
    days,
    flights_cost_usd: 0,
    estimated_total_usd: 0,
    estimated_total_complete: true,
    dates_provisional: false,
    construction_notes: [],
    ...overrides,
  };
}

function makeBrief(overrides: Partial<TripBrief> = {}): TripBrief {
  return {
    origin: null,
    destinations: ["Meghalaya"],
    region_hint: null,
    date_expression: null,
    start_date: null,
    end_date: null,
    nights: 4,
    flexible_dates: false,
    travellers: { count: 2, adults: 2, children: 0 },
    budget_amount: null,
    budget_currency: null,
    budget_includes_flights: false,
    pace: "relaxed",
    interests: [],
    dietary: [],
    mobility_needs: [],
    visa_constraints: [],
    must_include: [],
    must_avoid: [],
    open_questions: [],
    ...overrides,
  };
}

describe("haversineKm", () => {
  it("is ~0 for identical points and grows with real separation", () => {
    expect(haversineKm({ lat: 25.28, lng: 91.73 }, { lat: 25.28, lng: 91.73 })).toBeCloseTo(0, 5);
    // Sohra to the Nongriat double-decker root bridge — recorded distance from
    // the elevation fixture context: ~6.5km straight-line.
    const d = haversineKm({ lat: 25.2777336, lng: 91.7292416 }, { lat: 25.2514562, lng: 91.6716581 });
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(7);
  });
});

describe("estimateTransitMinutes", () => {
  it("picks the flat tier for a low grade, floored by MIN_TRANSIT_MINUTES", () => {
    // The recorded flat Bangkok pair: 3.34km, 5m delta -> ~1.5m/km, well under
    // the hilly threshold. 3.34/40*60 ~= 5min, floored to MIN_TRANSIT_MINUTES.
    const from = { lat: 13.7563, lng: 100.5018 };
    const to = { lat: 13.744, lng: 100.53 };
    const result = estimateTransitMinutes(from, to, 5);
    expect(result.source).toBe("heuristic");
    expect(result.minutes).toBe(MIN_TRANSIT_MINUTES);
  });

  it("picks the hilly tier for a mid-range grade", () => {
    const from = { lat: 0, lng: 0 };
    const to = { lat: 0.09, lng: 0 }; // ~10km
    const distanceKm = haversineKm(from, to);
    const elevationDeltaM = distanceKm * (GRADE_THRESHOLDS_M_PER_KM.hilly + 5); // solidly in the hilly band
    const result = estimateTransitMinutes(from, to, elevationDeltaM);
    expect(result.source).toBe("heuristic");
    expect(result.minutes).toBe(Math.round((distanceKm / TERRAIN_SPEED_KMH.hilly) * 60));
  });

  it("picks the very_steep tier for the real Sohra -> Nongriat grade (the Nongriat catch)", () => {
    const from = { lat: 25.2777336, lng: 91.7292416 }; // Sohra
    const to = { lat: 25.2514562, lng: 91.6716581 }; // Double decker root bridge
    const elevationDeltaM = 1345 - 386; // recorded elevations, see elevation.test.ts fixture
    const distanceKm = haversineKm(from, to);
    const result = estimateTransitMinutes(from, to, elevationDeltaM);
    expect(result.source).toBe("heuristic");
    expect(result.minutes).toBe(Math.round((distanceKm / TERRAIN_SPEED_KMH.very_steep) * 60));
    expect(result.minutes).toBeGreaterThan(60); // this is a multi-hour trek, not a 20min drive
  });

  it("marks the result 'unknown' and uses the flat tier as a placeholder when elevation is unavailable", () => {
    const from = { lat: 25.2777336, lng: 91.7292416 };
    const to = { lat: 25.2514562, lng: 91.6716581 };
    const result = estimateTransitMinutes(from, to, null);
    expect(result.source).toBe("unknown");
    const distanceKm = haversineKm(from, to);
    expect(result.minutes).toBe(Math.round((distanceKm / TERRAIN_SPEED_KMH.flat) * 60));
  });

  it("never returns less than MIN_TRANSIT_MINUTES, even for a zero-distance hop", () => {
    const point = { lat: 25.28, lng: 91.73 };
    expect(estimateTransitMinutes(point, point, 0).minutes).toBe(MIN_TRANSIT_MINUTES);
  });
});

describe("checkBudget", () => {
  const itinerary = makeItinerary([
    makeDay([makeStop({ activity: makeActivity({ cost_usd_per_person: 100 }) })]),
  ]);

  it("passes when total is within budget", () => {
    const brief = makeBrief({ budget_amount: 500, budget_currency: "USD" });
    expect(checkBudget(itinerary, brief)).toEqual({ failures: [], notes: [] });
  });

  it("fails when total exceeds budget", () => {
    const brief = makeBrief({ budget_amount: 50, budget_currency: "USD" });
    const { failures, notes } = checkBudget(itinerary, brief);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.code).toBe("OVER_BUDGET");
    expect(notes).toEqual([]);
  });

  it("has no opinion when no budget was stated", () => {
    const brief = makeBrief({ budget_amount: null, budget_currency: null });
    expect(checkBudget(itinerary, brief)).toEqual({ failures: [], notes: [] });
  });

  it("still hard-fails OVER_BUDGET when incomplete, if known costs alone already exceed budget", () => {
    // 2 people * $100/head = $200 in known activity cost. Lodging is unknown
    // (null), but $200 alone already exceeds a $50 budget — no lodging figure
    // could bring that back under, since costs are never negative.
    const day = makeDay([makeStop({ activity: makeActivity({ cost_usd_per_person: 100 }) })]);
    day.lodging_cost_usd = null;
    const incomplete = makeItinerary([day]);
    const brief = makeBrief({ budget_amount: 50, budget_currency: "USD" });
    const { failures, notes } = checkBudget(incomplete, brief);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.code).toBe("OVER_BUDGET");
    expect(notes).toEqual([]);
  });

  it("downgrades to a note (not a pass, not a failure) when incomplete and known costs are under budget", () => {
    const day = makeDay([makeStop({ activity: makeActivity({ cost_usd_per_person: 100 }) })]);
    day.lodging_cost_usd = null; // unpriced — no lodging tool yet
    const incomplete = makeItinerary([day]);
    const brief = makeBrief({ budget_amount: 5000, budget_currency: "USD" });
    const { failures, notes } = checkBudget(incomplete, brief);
    expect(failures).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("incomplete");
  });
});

describe("checkDay — existing hard failures still fire on ordinary (non-unknown) transit data", () => {
  const limits = DEFAULT_LIMITS.relaxed;

  it("IMPOSSIBLE_TRANSIT: not enough time between stops given the stated transit", () => {
    const day = makeDay([
      makeStop({ start: "09:00", end: "10:00" }),
      makeStop({
        start: "10:10",
        end: "11:00",
        transit_minutes_from_previous: 60,
        transit_source: "heuristic",
      }),
    ]);
    const { failures } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).toContain("IMPOSSIBLE_TRANSIT");
  });

  it("HOP_TOO_FAR: fires on real distance regardless of transit_source", () => {
    const day = makeDay([
      makeStop({ activity: makeActivity({ location: { lat: 25.0, lng: 91.0 } }) }),
      makeStop({
        activity: makeActivity({ location: { lat: 26.5, lng: 92.5 } }), // far beyond maxHopKm
        transit_source: "unknown",
        transit_minutes_from_previous: 10,
      }),
    ]);
    const { failures } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).toContain("HOP_TOO_FAR");
  });

  it("TOO_MUCH_TRANSIT: fires when the (trusted) total exceeds the pace limit", () => {
    const day = makeDay([
      makeStop({ start: "09:00", end: "09:30" }),
      makeStop({
        start: "11:00",
        end: "12:00",
        transit_minutes_from_previous: limits.maxTransitMinutes + 30,
        transit_source: "heuristic",
      }),
    ]);
    const { failures, notes } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).toContain("TOO_MUCH_TRANSIT");
    expect(notes).toEqual([]);
  });

  it("CLOSED_THAT_DAY / BEFORE_OPENING / AFTER_CLOSING / NEGATIVE_DURATION still fire", () => {
    const weekday = new Date("2026-07-27T00:00:00Z").getUTCDay();
    const day = makeDay([
      makeStop({
        start: "10:00",
        end: "09:00", // ends before it starts
        activity: makeActivity({
          closed_days: [weekday],
          opens: "11:00",
          closes: "08:00", // end (09:00) is after this, so AFTER_CLOSING fires too
        }),
      }),
    ]);
    const { failures } = checkDay(day, limits);
    const codes = failures.map((f) => f.code);
    expect(codes).toContain("NEGATIVE_DURATION");
    expect(codes).toContain("CLOSED_THAT_DAY");
    expect(codes).toContain("BEFORE_OPENING");
    expect(codes).toContain("AFTER_CLOSING");
  });
});

describe("checkDay — transit_source 'unknown' is downgraded to a note, not a hard failure", () => {
  const limits = DEFAULT_LIMITS.relaxed;

  it("suppresses IMPOSSIBLE_TRANSIT for an unknown leg and notes it instead", () => {
    const day = makeDay([
      makeStop({ start: "09:00", end: "10:00" }),
      makeStop({
        start: "10:10",
        end: "11:00",
        transit_minutes_from_previous: 60, // would be impossible if trusted
        transit_source: "unknown",
        activity: makeActivity({ name: "Nongriat Root Bridge" }),
      }),
    ]);
    const { failures, notes } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).not.toContain("IMPOSSIBLE_TRANSIT");
    expect(notes.some((n) => n.includes("Nongriat Root Bridge"))).toBe(true);
  });

  it("downgrades TOO_MUCH_TRANSIT to a note when the total includes an unknown leg", () => {
    const day = makeDay([
      makeStop({ start: "09:00", end: "09:30" }),
      makeStop({
        start: "12:00",
        end: "13:00",
        transit_minutes_from_previous: limits.maxTransitMinutes + 30,
        transit_source: "unknown",
      }),
    ]);
    const { failures, notes } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).not.toContain("TOO_MUCH_TRANSIT");
    expect(notes.some((n) => n.includes("may exceed"))).toBe(true);
  });

  it("downgrades DAY_TOO_LONG to a note when the total includes an unknown leg", () => {
    const day = makeDay([
      makeStop({
        start: "07:00",
        end: "07:00", // long day comes entirely from the transit figure below
        activity: makeActivity({ duration_minutes: 1 }),
      }),
      makeStop({
        start: "07:00",
        end: "07:01",
        transit_minutes_from_previous: limits.maxActiveMinutes + 60,
        transit_source: "unknown",
      }),
    ]);
    const { failures, notes } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).not.toContain("DAY_TOO_LONG");
    expect(notes.some((n) => n.includes("total day length"))).toBe(true);
  });

  it("produces no note at all when an unknown leg exists but nothing is actually over any limit", () => {
    const day = makeDay([
      makeStop({ start: "09:00", end: "09:30" }),
      makeStop({
        start: "09:45",
        end: "10:15",
        transit_minutes_from_previous: 15,
        transit_source: "unknown",
        activity: makeActivity({ name: "Nearby Spot" }),
      }),
    ]);
    const { failures, notes } = checkDay(day, limits);
    expect(failures).toEqual([]);
    expect(notes).toHaveLength(1); // just the per-leg "could not be estimated" note
    expect(notes[0]).toContain("Nearby Spot");
  });
});

describe("checkDay — provisional dates downgrade CLOSED_THAT_DAY only, not the whole day", () => {
  const limits = DEFAULT_LIMITS.relaxed;

  it("downgrades CLOSED_THAT_DAY to a note when datesProvisional is true", () => {
    const weekday = new Date("2026-07-27T00:00:00Z").getUTCDay();
    const day = makeDay([
      makeStop({
        activity: makeActivity({ name: "Maybe-Closed Museum", closed_days: [weekday] }),
      }),
    ]);
    const { failures, notes } = checkDay(day, limits, true);
    expect(failures.map((f) => f.code)).not.toContain("CLOSED_THAT_DAY");
    expect(notes.some((n) => n.includes("Maybe-Closed Museum") && n.includes("provisional"))).toBe(
      true,
    );
  });

  it("still hard-fails CLOSED_THAT_DAY when dates are real (datesProvisional false/default)", () => {
    const weekday = new Date("2026-07-27T00:00:00Z").getUTCDay();
    const day = makeDay([makeStop({ activity: makeActivity({ closed_days: [weekday] }) })]);
    const { failures } = checkDay(day, limits);
    expect(failures.map((f) => f.code)).toContain("CLOSED_THAT_DAY");
  });

  it("does not affect BEFORE_OPENING/AFTER_CLOSING, which depend on clock time, not weekday", () => {
    const day = makeDay([
      makeStop({
        start: "07:00",
        end: "08:00",
        activity: makeActivity({ opens: "09:00" }),
      }),
    ]);
    const { failures } = checkDay(day, limits, true);
    expect(failures.map((f) => f.code)).toContain("BEFORE_OPENING");
  });
});

describe("checkItinerary", () => {
  it("aggregates budget, per-day failures/notes, and date-range checks together", () => {
    const brief = makeBrief({
      pace: "relaxed",
      budget_amount: 1,
      budget_currency: "USD",
      start_date: "2026-07-27",
      end_date: "2026-07-27",
    });
    const itinerary = makeItinerary([
      makeDay(
        [
          makeStop({ activity: makeActivity({ cost_usd_per_person: 1000 }) }),
          makeStop({
            start: "10:10",
            end: "11:00",
            transit_minutes_from_previous: 60,
            transit_source: "unknown",
            activity: makeActivity({ name: "Far Spot" }),
          }),
        ],
        "2026-07-27",
      ),
      makeDay([makeStop()], "2026-07-27"), // duplicate date
      makeDay([makeStop()], "2026-07-30"), // after end_date
    ]);

    const { failures, notes } = checkItinerary(itinerary, brief);
    const codes = failures.map((f) => f.code);
    expect(codes).toContain("OVER_BUDGET");
    expect(codes).toContain("DUPLICATE_DATE");
    expect(codes).toContain("DATE_AFTER_END");
    expect(codes).not.toContain("IMPOSSIBLE_TRANSIT"); // that leg was "unknown"
    expect(notes.some((n) => n.includes("Far Spot"))).toBe(true);
  });
});
