import type { DayPlan, Itinerary, TripBrief } from "../schemas/index.js";

/**
 * CLAUDE.md rule 2 lives here. No model touches this arithmetic.
 * The Critic agent calls these and reports the results as hard_failures.
 */

export interface CheckFailure {
  code: string;
  message: string;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Total cost. Computed, never trusted from the model. */
export function computeTotalUsd(itinerary: Itinerary, brief: TripBrief): number {
  const people = brief.travellers.count;
  const activities = itinerary.days.reduce(
    (sum, day) =>
      sum + day.stops.reduce((s, stop) => s + stop.activity.cost_usd_per_person * people, 0),
    0,
  );
  const lodging = itinerary.days.reduce((sum, day) => sum + day.lodging_cost_usd, 0);
  const flights = brief.budget_includes_flights ? itinerary.flights_cost_usd : 0;
  return Math.round((activities + lodging + flights) * 100) / 100;
}

export function checkBudget(itinerary: Itinerary, brief: TripBrief): CheckFailure[] {
  if (brief.budget_total_usd === null) return [];
  const total = computeTotalUsd(itinerary, brief);
  if (total <= brief.budget_total_usd) return [];
  return [
    {
      code: "OVER_BUDGET",
      message: `Total $${total} exceeds stated budget $${brief.budget_total_usd} by $${(
        total - brief.budget_total_usd
      ).toFixed(2)}.`,
    },
  ];
}

export interface DayLimits {
  maxTransitMinutes: number;
  maxActiveMinutes: number;
  maxHopKm: number;
  dayStart: string;
  dayEnd: string;
}

export const DEFAULT_LIMITS: Record<TripBrief["pace"], DayLimits> = {
  relaxed: { maxTransitMinutes: 120, maxActiveMinutes: 360, maxHopKm: 25, dayStart: "09:00", dayEnd: "20:00" },
  moderate: { maxTransitMinutes: 180, maxActiveMinutes: 480, maxHopKm: 40, dayStart: "08:30", dayEnd: "21:30" },
  packed: { maxTransitMinutes: 240, maxActiveMinutes: 600, maxHopKm: 60, dayStart: "07:30", dayEnd: "23:00" },
};

export function checkDay(day: DayPlan, limits: DayLimits): CheckFailure[] {
  const failures: CheckFailure[] = [];
  if (day.stops.length === 0) return failures;

  let transit = 0;
  let active = 0;
  let previousEnd = -1;

  day.stops.forEach((stop, i) => {
    const start = toMinutes(stop.start);
    const end = toMinutes(stop.end);

    if (end <= start) {
      failures.push({
        code: "NEGATIVE_DURATION",
        message: `${day.date}: "${stop.activity.name}" ends at or before it starts.`,
      });
    }

    const previous = i > 0 ? day.stops[i - 1] : undefined;

    if (previous && start < previousEnd + stop.transit_minutes_from_previous) {
      failures.push({
        code: "IMPOSSIBLE_TRANSIT",
        message: `${day.date}: cannot reach "${stop.activity.name}" by ${stop.start} — previous stop ends at ${previous.end} and transit is ${stop.transit_minutes_from_previous}min.`,
      });
    }

    if (previous) {
      const hop = haversineKm(previous.activity.location, stop.activity.location);
      if (hop > limits.maxHopKm) {
        failures.push({
          code: "HOP_TOO_FAR",
          message: `${day.date}: ${hop.toFixed(0)}km between "${previous.activity.name}" and "${stop.activity.name}" (limit ${limits.maxHopKm}km).`,
        });
      }
    }

    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    if (stop.activity.closed_days.includes(weekday)) {
      failures.push({
        code: "CLOSED_THAT_DAY",
        message: `${day.date}: "${stop.activity.name}" is closed on this weekday.`,
      });
    }
    if (stop.activity.opens && start < toMinutes(stop.activity.opens)) {
      failures.push({
        code: "BEFORE_OPENING",
        message: `${day.date}: "${stop.activity.name}" scheduled at ${stop.start} but opens at ${stop.activity.opens}.`,
      });
    }
    if (stop.activity.closes && end > toMinutes(stop.activity.closes)) {
      failures.push({
        code: "AFTER_CLOSING",
        message: `${day.date}: "${stop.activity.name}" runs to ${stop.end} but closes at ${stop.activity.closes}.`,
      });
    }

    transit += stop.transit_minutes_from_previous;
    active += end - start;
    previousEnd = end;
  });

  if (transit > limits.maxTransitMinutes) {
    failures.push({
      code: "TOO_MUCH_TRANSIT",
      message: `${day.date}: ${transit}min in transit exceeds the ${limits.maxTransitMinutes}min limit for this pace.`,
    });
  }
  if (active + transit > limits.maxActiveMinutes) {
    failures.push({
      code: "DAY_TOO_LONG",
      message: `${day.date}: ${active + transit}min scheduled exceeds the ${limits.maxActiveMinutes}min limit for this pace.`,
    });
  }

  return failures;
}

export function checkItinerary(itinerary: Itinerary, brief: TripBrief): CheckFailure[] {
  const limits = DEFAULT_LIMITS[brief.pace];
  const failures = [
    ...checkBudget(itinerary, brief),
    ...itinerary.days.flatMap((day) => checkDay(day, limits)),
  ];

  const dates = itinerary.days.map((d) => d.date);
  if (new Set(dates).size !== dates.length) {
    failures.push({ code: "DUPLICATE_DATE", message: "Itinerary contains duplicate dates." });
  }
  if (brief.start_date && dates.some((d) => d < brief.start_date!)) {
    failures.push({ code: "DATE_BEFORE_START", message: "A day falls before the trip start date." });
  }
  if (brief.end_date && dates.some((d) => d > brief.end_date!)) {
    failures.push({ code: "DATE_AFTER_END", message: "A day falls after the trip end date." });
  }

  return failures;
}
