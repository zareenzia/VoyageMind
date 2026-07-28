import type { DayPlan, Itinerary, TransitSource, TripBrief } from "../schemas/index.js";
import { budgetInUsd } from "../tools/currency.js";

/**
 * CLAUDE.md rule 2 lives here. No model touches this arithmetic.
 * The Critic agent calls these and reports the results as hard_failures.
 */

export interface CheckFailure {
  code: string;
  message: string;
}

/** Hard failures plus non-blocking notes — see checkDay's handling of
 * transit_source "unknown" for where notes come from. */
export interface CheckResult {
  failures: CheckFailure[];
  notes: string[];
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

/**
 * Speed assumption per terrain tier, chosen from a SOURCED elevation-delta-per-km
 * signal (src/tools/elevation.ts) — not fabricated road-class awareness. A
 * formula that looks routed while only ever looking at two endpoints is fake
 * precision: worse than an honest constant, because it gets trusted more.
 *
 * `very_steep` exists specifically because Meghalaya's plateau-edge attractions
 * (the Nongriat root bridges: Sohra to Nongriat is a ~700m descent on foot, down
 * thousands of steps, not a road at all) would otherwise read as a 20-minute
 * hill-road drive under a two-tier model — an optimistic wrong answer that makes
 * "hard failure" meaningless.
 *
 * Known limitations, deliberately not fixed here — both disappear once real
 * routing (OSRM or similar) replaces this heuristic:
 *   - Endpoint-only: elevation is sampled at the two stops only. Two points at
 *     similar elevation with a gorge between them read as flat. Meghalaya's
 *     plateau landscape is exactly this failure case.
 *   - Symmetric: Math.abs() treats a descent and the return climb identically,
 *     though real travel time for the two directions can differ substantially.
 */
export const TERRAIN_SPEED_KMH = {
  flat: 40,
  hilly: 20,
  very_steep: 4,
} as const;

/** Elevation change per km of straight-line distance, in metres, at or above
 * which a leg is classified into the next tier. Tunable and explainable. */
export const GRADE_THRESHOLDS_M_PER_KM = {
  hilly: 30,
  very_steep: 100,
} as const;

/** No hop is instantaneous — there's always getting up, walking to the car. */
export const MIN_TRANSIT_MINUTES = 10;

export interface TransitEstimate {
  minutes: number;
  source: TransitSource;
}

/**
 * Pure — no network, no I/O. Callers fetch elevation (tools/elevation.ts) and
 * pass the delta in; this function never calls anything itself.
 *
 * `elevationDeltaM: null` means elevation genuinely could not be obtained (the
 * Open-Meteo call failed for this destination) — NOT "assume flat ground". A
 * flat-tier number is still computed, as a placeholder so downstream schedule
 * arithmetic has something to work with, but it is marked `source: "unknown"`
 * so checkDay treats it as untrusted rather than a hard fact.
 */
export function estimateTransitMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  elevationDeltaM: number | null,
): TransitEstimate {
  const distanceKm = haversineKm(from, to);

  if (elevationDeltaM === null) {
    const minutes = Math.max(
      MIN_TRANSIT_MINUTES,
      Math.round((distanceKm / TERRAIN_SPEED_KMH.flat) * 60),
    );
    return { minutes, source: "unknown" };
  }

  const gradeMPerKm = distanceKm > 0 ? Math.abs(elevationDeltaM) / distanceKm : 0;
  const speedKmh =
    gradeMPerKm >= GRADE_THRESHOLDS_M_PER_KM.very_steep
      ? TERRAIN_SPEED_KMH.very_steep
      : gradeMPerKm >= GRADE_THRESHOLDS_M_PER_KM.hilly
        ? TERRAIN_SPEED_KMH.hilly
        : TERRAIN_SPEED_KMH.flat;

  const minutes = Math.max(MIN_TRANSIT_MINUTES, Math.round((distanceKm / speedKmh) * 60));
  return { minutes, source: "heuristic" };
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
  // Conversion happens in src/tools/currency.ts, not here and not in an agent.
  const budgetUsd = budgetInUsd(brief.budget_amount, brief.budget_currency);
  if (budgetUsd === null) return [];
  const total = computeTotalUsd(itinerary, brief);
  if (total <= budgetUsd) return [];
  const stated =
    brief.budget_currency === "USD"
      ? `$${brief.budget_amount}`
      : `${brief.budget_amount} ${brief.budget_currency} (~$${budgetUsd})`;
  return [
    {
      code: "OVER_BUDGET",
      message: `Total $${total} exceeds stated budget ${stated} by $${(
        total - budgetUsd
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

export function checkDay(day: DayPlan, limits: DayLimits): CheckResult {
  const failures: CheckFailure[] = [];
  const notes: string[] = [];
  if (day.stops.length === 0) return { failures, notes };

  let transit = 0;
  let active = 0;
  let previousEnd = -1;
  // True once ANY leg's transit time is unverified. From there, the running
  // `transit` total is tainted — a sum that includes an untrusted number is
  // itself untrusted, so TOO_MUCH_TRANSIT and DAY_TOO_LONG (which both depend on
  // it) get downgraded to a note for the whole day rather than a hard failure.
  let hasUnknownTransit = false;

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

    if (previous && stop.transit_source === "unknown") {
      hasUnknownTransit = true;
      notes.push(
        `${day.date}: travel time to "${stop.activity.name}" could not be estimated ` +
          `(elevation data unavailable) — not checked for feasibility.`,
      );
    } else if (previous && start < previousEnd + stop.transit_minutes_from_previous) {
      failures.push({
        code: "IMPOSSIBLE_TRANSIT",
        message: `${day.date}: cannot reach "${stop.activity.name}" by ${stop.start} — previous stop ends at ${previous.end} and transit is ${stop.transit_minutes_from_previous}min.`,
      });
    }

    if (previous) {
      // Distance is exact, not estimated — this check stands regardless of
      // transit_source.
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
    if (hasUnknownTransit) {
      notes.push(
        `${day.date}: total transit (${transit}min) may exceed the ${limits.maxTransitMinutes}min ` +
          `limit for this pace, but one or more legs have unknown travel time, so this could not ` +
          `be verified as a hard failure.`,
      );
    } else {
      failures.push({
        code: "TOO_MUCH_TRANSIT",
        message: `${day.date}: ${transit}min in transit exceeds the ${limits.maxTransitMinutes}min limit for this pace.`,
      });
    }
  }
  if (active + transit > limits.maxActiveMinutes) {
    if (hasUnknownTransit) {
      notes.push(
        `${day.date}: total day length (${active + transit}min) may exceed the ` +
          `${limits.maxActiveMinutes}min limit for this pace, but one or more legs have unknown ` +
          `travel time, so this could not be verified as a hard failure.`,
      );
    } else {
      failures.push({
        code: "DAY_TOO_LONG",
        message: `${day.date}: ${active + transit}min scheduled exceeds the ${limits.maxActiveMinutes}min limit for this pace.`,
      });
    }
  }

  return { failures, notes };
}

export function checkItinerary(itinerary: Itinerary, brief: TripBrief): CheckResult {
  const limits = DEFAULT_LIMITS[brief.pace];
  const dayResults = itinerary.days.map((day) => checkDay(day, limits));

  const failures = [
    ...checkBudget(itinerary, brief),
    ...dayResults.flatMap((r) => r.failures),
  ];
  const notes = dayResults.flatMap((r) => r.notes);

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

  return { failures, notes };
}
