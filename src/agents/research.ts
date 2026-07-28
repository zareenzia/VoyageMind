/**
 * The Guide agent (file name is a holdover from CLAUDE.md's original stub list —
 * there is no separate "Research" agent in the current five-agent design).
 *
 * TripBrief + one destination name -> Destination, with its candidate activities.
 * Absorbs the spec's original Local Guide, Recommendation, and part of Safety.
 *
 * Two functions, deliberately separated:
 *   - runGuide: pure judgement over already-fetched facts. No network calls, no
 *     tool calls — this is what evals exercise, offline.
 *   - researchDestination: the plain-code wrapper that calls geocode() and
 *     findPlaces() first (rule 3 — no agent calls an external API directly,
 *     including indirectly via letting the model decide when to fetch) and then
 *     calls runGuide with the results. This is what the orchestrator will call.
 */

import { MODELS, LIMITS } from "../config.js";
import {
  DestinationJudgmentSchema,
  PlaceCategorySchema,
  type Destination,
  type PlaceCandidate,
  type TripBrief,
} from "../schemas/index.js";
import { runAgent } from "./run.js";
import { geocode } from "../tools/geocode.js";
import { findPlaces } from "../tools/places.js";

const ALL_CATEGORIES = PlaceCategorySchema.options;

const SYSTEM_PROMPT = `You are the Guide agent in a travel planning pipeline.

Your job: given a destination and a list of REAL, sourced candidate places (from
OpenStreetMap), decide which ones best fit this traveller and explain why this
destination suits them. You are the only agent that turns raw place data into a
travel recommendation — downstream agents trust what you produce without
re-checking it against the source data.

RULES

1. Every activity you return MUST use the osm_type and osm_id of one of the
   candidates you were given, copied exactly. Do not invent a place, and do not
   alter an id. If somewhere good is not in the candidate list, you cannot
   include it — leave it out instead. This is checked in code after you respond;
   a fabricated or altered id is rejected and you will be asked to fix it.

2. You were NOT given duration, cost, or reliable opening hours for any
   candidate — OpenStreetMap doesn't have trustworthy versions of these for most
   places. Estimate duration_minutes and cost_usd_per_person yourself and always
   set estimated.duration = true and estimated.cost = true.

3. opening_hours_raw, where present, is unparsed OSM syntax — treat it as loose
   context at most, never as ground truth for opens/closes. Estimate opens/closes
   yourself from the category and general convention (e.g. viewpoints and
   waterfalls: daylight hours; museums: standard business hours) and always set
   estimated.hours = true.

4. Favour candidates with higher "prominence" for headline activities, but don't
   ignore low-prominence ones — they're reasonable filler for a quieter part of
   a day. Never invent an activity to fill a gap: if there aren't enough good
   candidates, return fewer activities. If you were given zero candidates,
   return activities: [] and say so plainly in why_it_fits.

5. best_months is about when it's good to VISIT and do things outdoors — not
   when a place is "in season" by some other measure. A destination's wettest,
   stormiest, or most extreme months are usually bad recommendations for a
   sightseeing trip even when locals or tourism material describe that season
   positively.

6. Respect the traveller's pace, interests, dietary needs, mobility needs,
   must_include and must_avoid. A packed pace supports more activities; a
   relaxed pace should have fewer, unhurried ones.

OUTPUT

Return a single JSON object matching the required schema. No markdown, no
explanation before or after. JSON only.`;

function candidateKey(osmType: string, osmId: number): string {
  return `${osmType}/${osmId}`;
}

function summarizeList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none stated";
}

function buildPrompt(
  brief: TripBrief,
  destinationName: string,
  candidates: PlaceCandidate[],
): string {
  return [
    `Destination: ${destinationName}`,
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
    `Candidate places, sourced from OpenStreetMap. These are the ONLY places you ` +
      `may build activities from — "prominence" is a notability signal, not a ` +
      `requirement to use the top ones:`,
    JSON.stringify(candidates, null, 2),
  ].join("\n");
}

export interface GuideInput {
  brief: TripBrief;
  destinationName: string;
  /** Sourced from geocode.ts — the model never sees or reproduces these. */
  country: string;
  centre: { lat: number; lng: number };
  candidates: PlaceCandidate[];
}

/**
 * Pure judgement over already-fetched facts — no network calls. This is what
 * evals/cases/guide.json exercises, entirely offline.
 */
export async function runGuide(input: GuideInput): Promise<Destination> {
  const sorted = [...input.candidates].sort((a, b) => b.prominence - a.prominence);
  const capped = sorted.slice(0, LIMITS.candidatesPerDestination);
  if (capped.length < sorted.length) {
    console.error(
      `[guide] "${input.destinationName}": truncated ${sorted.length} candidates to the ` +
        `top ${capped.length} by prominence.`,
    );
  }

  const validIds = new Set(capped.map((c) => candidateKey(c.osm_type, c.osm_id)));

  const judgment = await runAgent({
    name: "guide",
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input.brief, input.destinationName, capped),
    schema: DestinationJudgmentSchema,
    model: MODELS.fast,
    validate: (data) => {
      const fabricated = data.activities.filter(
        (activity) => !validIds.has(candidateKey(activity.osm_type, activity.osm_id)),
      );
      if (fabricated.length === 0) return null;

      const described = fabricated
        .map((activity) => `"${activity.name}" (${activity.osm_type}/${activity.osm_id})`)
        .join(", ");
      return (
        `These activities reference an osm_type/osm_id that is not in the candidate list ` +
        `you were given: ${described}. Every activity must copy the osm_type and osm_id of ` +
        `one of the provided candidates exactly — do not invent one or alter one you were given.`
      );
    },
  });

  return {
    name: input.destinationName,
    country: input.country,
    centre: input.centre,
    ...judgment,
  };
}

/**
 * The plain-code wrapper: geocodes the destination, fetches candidates over its
 * bounding box, then calls runGuide. This is what the orchestrator calls — the
 * model itself never touches Overpass or Nominatim.
 *
 * TODO: categories are unfiltered (every category we support) — mapping
 * brief.interests to a narrower category set would cut down noise further, but
 * that's a refinement, not something Phase 0 needs yet.
 */
export async function researchDestination(
  brief: TripBrief,
  destinationName: string,
): Promise<Destination> {
  const place = await geocode(destinationName);
  if (place.country === null) {
    throw new Error(
      `Could not determine a country for "${destinationName}" — Nominatim returned no ` +
        `country in its address breakdown for this result.`,
    );
  }

  const candidates = await findPlaces({
    area: { kind: "bbox", bbox: place.bbox },
    categories: ALL_CATEGORIES,
  });

  return runGuide({
    brief,
    destinationName,
    country: place.country,
    centre: place.centre,
    candidates,
  });
}
