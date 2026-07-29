/**
 * The Itinerary agent. Destination[] + TripBrief -> Itinerary.
 *
 * Rule 2, applied structurally: the model's own output (ItineraryJudgmentSchema)
 * is an ORDER — a date slot, a base city, and a list of activity osm refs — and
 * nothing clock-related at all. It never states a date, a start/end time, or a
 * transit duration. All of that is code: this file resolves date slots to real
 * calendar dates (tools/dates.ts), walks the model's chosen order attaching
 * start/end/transit_minutes_from_previous (estimateTransitMinutes, elevation
 * fetched once per call), and computes the running cost total. If the model
 * can't state a time, it can't state a wrong one — same discipline as
 * DestinationJudgmentSchema omitting centre.
 */

import { MODELS } from "../config.js";
import {
  ItineraryJudgmentSchema,
  type Activity,
  type Destination,
  type DayPlan,
  type Itinerary,
  type ScheduledStop,
  type TripBrief,
} from "../schemas/index.js";
import { runAgent } from "./run.js";
import { getElevations } from "../tools/elevation.js";
import { combineBestMonths, pickProvisionalDates, addDays } from "../tools/dates.js";
import {
  computeTotalUsd,
  estimateTransitMinutes,
  DEFAULT_LIMITS,
  type DayLimits,
} from "../checks/feasibility.js";

const SYSTEM_PROMPT = `You are the Itinerary agent in a travel planning pipeline.

Your job: given researched destinations (each with real, sourced candidate
activities) and the traveller's brief, decide the ORDER activities should be
visited in, across the days of the trip. You do not decide clock times, dates,
or transit durations — those are computed by code from the order you choose.

RULES

1. Produce exactly one entry per day of the trip: date_slot 0 through N-1 where
   N is the day count given below. Every slot exactly once — no gaps, no
   repeats, no day skipped even if it ends up with few or no activities.

2. Every activity you place MUST use the osm_type and osm_id of one Activity
   from the Destination[] you were given, copied exactly. An activity may
   appear on at most one day — never repeat the same place across days. Never
   invent one. This is checked in code after you respond, and a fabricated or
   duplicated reference is rejected and you'll be asked to fix it.

3. You are not given clock times, but you ARE given each activity's
   duration_minutes and, where known, opens/closes, plus the pace's day-start/
   day-end window and per-day transit/active-time limits below — use these to
   judge roughly how much reasonably fits in a day. Getting this approximately
   right matters, but code computes the real times afterward and the Critic
   will tell you specifically what didn't fit if a revision is needed.

4. Sequence for sensible geography within a day using the coordinates and
   prominence given — don't zigzag across a region if a simpler order visits
   the same places.

5. base_city: name the specific town or area that day is based out of. This
   can be more specific than a destination's own name (e.g. destination
   "Meghalaya", base_city "Sohra").

6. Not every activity you were given needs to be used — pick what fits the
   traveller's pace, interests, dietary needs, mobility needs, must_include
   and must_avoid. Fewer well-chosen activities beat an overstuffed day.

OUTPUT

Return a single JSON object matching the required schema. No markdown, no
explanation before or after. JSON only.`;

function activityKey(ref: { osm_type: string; osm_id: number }): string {
  return `${ref.osm_type}/${ref.osm_id}`;
}

function summarizeList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none stated";
}

function buildPrompt(
  brief: TripBrief,
  destinations: Destination[],
  dayCount: number,
  limits: DayLimits,
): string {
  return [
    `Trip length: ${dayCount} day(s) — produce date_slot 0 through ${dayCount - 1}.`,
    ``,
    `Traveller brief:`,
    `- party: ${brief.travellers.count} (${brief.travellers.adults} adults, ${brief.travellers.children} children)`,
    `- pace: ${brief.pace}`,
    `- interests: ${summarizeList(brief.interests)}`,
    `- dietary: ${summarizeList(brief.dietary)}`,
    `- mobility needs: ${summarizeList(brief.mobility_needs)}`,
    `- must include: ${summarizeList(brief.must_include)}`,
    `- must avoid: ${summarizeList(brief.must_avoid)}`,
    ``,
    `Per-day guidance for this pace (code will verify against these — not a hard cap on you):`,
    `- day runs roughly ${limits.dayStart} to ${limits.dayEnd}`,
    `- max active+transit time per day: ${limits.maxActiveMinutes}min`,
    `- max total transit per day: ${limits.maxTransitMinutes}min`,
    ``,
    `Destinations and their candidate activities — build your ordering ONLY from these:`,
    JSON.stringify(
      destinations.map((d) => ({
        name: d.name,
        why_it_fits: d.why_it_fits,
        activities: d.activities,
      })),
      null,
      2,
    ),
  ].join("\n");
}

export interface ItineraryInput {
  brief: TripBrief;
  destinations: Destination[];
  /** Explicit, like IntakeInput.today — never `new Date()` internally, so evals
   * stay deterministic regardless of when they're run. */
  today: string;
}

export async function runItinerary(input: ItineraryInput): Promise<Itinerary> {
  const { brief, destinations, today } = input;

  if (brief.nights === null) {
    throw new Error(
      "Cannot build an itinerary: trip length (nights) is unknown. This is an Intake gap, " +
        "not an Itinerary one — the traveller needs to answer how many nights (or days) the " +
        "trip is before planning can continue.",
    );
  }
  const nights = brief.nights;
  const dayCount = nights + 1;

  let startDate: string;
  let datesProvisional: boolean;
  const constructionNotes: string[] = [];

  if (brief.start_date) {
    startDate = brief.start_date;
    datesProvisional = false;
  } else {
    const combined = combineBestMonths(destinations);
    if (combined.note) constructionNotes.push(combined.note);
    startDate = pickProvisionalDates(today, nights, combined.months).start_date;
    datesProvisional = true;
  }
  // Each day's actual date comes from startDate + date_slot below — no separate
  // end_date is needed here (the last day IS the trip's end).

  const activitiesByKey = new Map<string, Activity>();
  for (const destination of destinations) {
    for (const activity of destination.activities) {
      activitiesByKey.set(activityKey(activity), activity);
    }
  }

  const allActivities = [...activitiesByKey.values()];
  let elevationByKey: Map<string, number> | null = new Map();
  try {
    const elevations = await getElevations(allActivities.map((a) => a.location));
    allActivities.forEach((a, i) => elevationByKey!.set(activityKey(a), elevations[i]!));
  } catch {
    elevationByKey = null; // whole-itinerary fallback: every leg becomes "unknown"
  }

  const limits = DEFAULT_LIMITS[brief.pace];

  const judgment = await runAgent({
    name: "itinerary",
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(brief, destinations, dayCount, limits),
    schema: ItineraryJudgmentSchema,
    model: MODELS.reasoning,
    validate: (data) => {
      const slots = data.days.map((d) => d.date_slot).sort((a, b) => a - b);
      const expectedSlots = Array.from({ length: dayCount }, (_, i) => i);
      if (JSON.stringify(slots) !== JSON.stringify(expectedSlots)) {
        return (
          `date_slot values must be exactly 0 through ${dayCount - 1}, each once. Got: ` +
          `[${slots.join(", ")}].`
        );
      }

      const allRefs = data.days.flatMap((d) => d.activities);
      const fabricated = allRefs.filter((ref) => !activitiesByKey.has(activityKey(ref)));
      if (fabricated.length > 0) {
        return (
          `These activity references don't match any Activity you were given: ` +
          fabricated.map((r) => activityKey(r)).join(", ") +
          `. Every osm_type/osm_id must be copied exactly from the Destination[] provided.`
        );
      }

      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const ref of allRefs) {
        const key = activityKey(ref);
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);
      }
      if (duplicates.size > 0) {
        return (
          `The same activity appears more than once across the trip: ` +
          `${[...duplicates].join(", ")}. Each activity may be scheduled at most once.`
        );
      }

      return null;
    },
  });

  const days: DayPlan[] = [...judgment.days]
    .sort((a, b) => a.date_slot - b.date_slot)
    .map((dayOrdering) => {
      const stops: ScheduledStop[] = [];
      let previousEnd = limits.dayStart;
      let previousActivity: Activity | null = null;

      for (const ref of dayOrdering.activities) {
        const activity = activitiesByKey.get(activityKey(ref))!;
        const elevationHere = elevationByKey?.get(activityKey(activity)) ?? null;
        const elevationPrev = previousActivity
          ? (elevationByKey?.get(activityKey(previousActivity)) ?? null)
          : null;

        let transitMinutes = 0;
        let transitSource: ScheduledStop["transit_source"] = "heuristic";
        if (previousActivity) {
          const elevationDelta =
            elevationHere !== null && elevationPrev !== null ? elevationHere - elevationPrev : null;
          const estimate = estimateTransitMinutes(
            previousActivity.location,
            activity.location,
            elevationDelta,
          );
          transitMinutes = estimate.minutes;
          transitSource = estimate.source;
        }

        const start = addMinutes(previousEnd, transitMinutes);
        const end = addMinutes(start, activity.duration_minutes);

        stops.push({
          activity,
          start,
          end,
          transit_minutes_from_previous: transitMinutes,
          transit_source: transitSource,
        });

        previousEnd = end;
        previousActivity = activity;
      }

      return {
        date: addDays(startDate, dayOrdering.date_slot),
        base_city: dayOrdering.base_city,
        stops,
        lodging_cost_usd: null, // no lodging tool yet — see spec §7.1
        notes: null,
      };
    });

  const itineraryWithoutTotals: Itinerary = {
    brief_summary: judgment.brief_summary,
    days,
    flights_cost_usd: null, // no transport tool yet — see spec §7.1
    estimated_total_usd: 0,
    estimated_total_complete: true,
    dates_provisional: datesProvisional,
    construction_notes: constructionNotes,
  };

  const { total_usd, complete } = computeTotalUsd(itineraryWithoutTotals, brief);

  return {
    ...itineraryWithoutTotals,
    estimated_total_usd: total_usd,
    estimated_total_complete: complete,
  };
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(wrapped / 60)
    .toString()
    .padStart(2, "0");
  const mm = (wrapped % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
