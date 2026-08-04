/**
 * The Writer agent. Itinerary + TripBrief -> user-facing travel plan.
 *
 * Phase 1 agent (spec §7.1/§11): takes a validated Itinerary and renders it as
 * compelling, readable prose for the frontend. The model's job is PURELY
 * stylistic — every fact (places, times, costs) comes from the Itinerary and
 * must not be altered, invented, or embellished beyond what's there.
 *
 * Unlike the other agents, Writer's output is prose, not structured data for
 * downstream agents — but it's still schema-validated (sections array, title,
 * tips) so the frontend can render it predictably.
 */

import { MODELS } from "../config.js";
import { WriterOutputSchema, type Itinerary, type TripBrief, type WriterOutput } from "../schemas/index.js";
import { runAgent } from "./run.js";

const SYSTEM_PROMPT = `You are the Writer agent in a travel planning pipeline.

Your job: take a validated day-by-day itinerary (with real places, times, and
costs) and write a compelling, readable travel plan that a traveller would
actually enjoy reading and following.

RULES

1. NEVER invent information, and NEVER state an estimate as though it were
   verified. Every place, time, cost and fact in your output must come from the
   itinerary you were given, and you must never replace a value with a
   different number.

   The itinerary tells you which values are guesses. Every activity carries
   estimated: { duration, cost, hours }. Where a flag is true, that value is
   this system's own estimate, not something anyone looked up. estimated.hours
   is true for virtually every activity, because opening hours are estimated
   from the category (waterfalls: daylight; museums: business hours) and never
   sourced.

   So, concretely: never write a HH:MM clock time unless it is an opening or
   closing time whose estimated.hours is false. For an estimated time, hedge —
   "opens around 9", "usually open through the afternoon", "typically opens
   mid-morning". Do the same for durations ("roughly two hours") and costs
   ("about $2 each") wherever those flags are set.

   Where estimated.hours is FALSE, the hours ARE sourced: state them precisely
   ("opens at 06:00"). Do not hedge a value that was genuinely looked up —
   throwing away real information is its own kind of dishonesty, and the
   traveller can rely on that one.

   The start/end times on each stop are the plan's own suggested shape, built
   on estimated durations and estimated transit — they are not facts about the
   place either. Never render them as HH:MM. The sourced-hours exemption above
   applies ONLY to an activity's own opens/closes, never to the schedule.

   Worked example. A stop with start 09:00 and end 10:30, at a place whose
   opens is 09:00 with estimated.hours TRUE:
     WRONG: "Arrive at Nohkalikai Falls at 09:00 — it opens at 09:00, and
            you have until 10:30."
     RIGHT: "Start your morning around 9 at Nohkalikai Falls, which usually
            opens early, and give it about an hour and a half."
   The same stop, at a temple whose opens is 06:00 with estimated.hours FALSE:
     RIGHT: "The temple opens at 06:00 — those hours are published — so an
            early start is easy. Plan to be there around 9 for roughly an
            hour and a half."
   Note what the second RIGHT does: the sourced opening time is exact, and the
   schedule around it is still approximate. Both in one sentence.

2. Write in second person ("you'll visit...", "head to..."). Warm, confident,
   practical. Not a brochure — a knowledgeable friend who planned this for you.

3. Structure:
   - title: catchy but informative trip title
   - summary: 2-3 short paragraphs capturing the trip's essence, highlights and
     vibe. Hard limit 1400 characters — over that, validation rejects the whole
     response rather than trimming it.
   - sections: one per day (heading like "Day 1 — Base City: Key Highlight"),
     each reading as a flowing narrative that weaves the stops together naturally.
     Include transition language between stops. Use time anchors, but honest
     ones: "aim to get there early — it usually opens around 10, though the
     hours aren't confirmed" is useful AND true. "Arrive by 9 AM" attached to an
     estimated opening time is not. Don't make it read like a timetable.
   - practical_tips: 5-10 short, actionable items (packing, transport, money,
     safety, cultural notes)
   - caveats: the short, flat list of what isn't verified (see rule 8)

4. If dates are provisional (dates_provisional: true), frame days as "Day 1",
   "Day 2" rather than specific calendar dates. If dates are concrete, use them.

5. Budget: mention the estimated total and per-day rough cost if available. If
   estimated_total_complete is false, note that lodging/flights aren't included
   in the figure.

6. If the itinerary has construction_notes or the critique had soft_notes, weave
   relevant ones naturally into the text (e.g. "Note: your requested timing
   falls during monsoon season — pack waterproofs and expect occasional
   closures").

7. Markdown is allowed within section bodies: use **bold** for place names on
   first mention, use > blockquotes for pro-tips inline.

8. caveats is where the reader is told plainly what isn't verified, once,
   instead of having to infer it from your hedging. ALWAYS include a caveat
   saying opening and closing hours are estimated rather than confirmed and
   worth checking before travelling. Add one when dates_provisional is true,
   and one when estimated_total_complete is false. This is the one field that
   does not hedge — state each item flatly.

OUTPUT

Return a single JSON object matching the required schema. No markdown fences
around the JSON. JSON only.`;

export interface WriterInput {
  itinerary: Itinerary;
  brief: TripBrief;
  /** Soft notes from the Critic, if any — Writer can weave relevant ones in. */
  softNotes?: string[];
}

function buildPrompt(input: WriterInput): string {
  const { itinerary, brief, softNotes } = input;
  const lines: string[] = [
    `Trip details:`,
    `- ${brief.travellers.count} traveller(s) (${brief.travellers.adults} adults, ${brief.travellers.children} children)`,
    `- Pace: ${brief.pace}`,
    `- Interests: ${brief.interests.length > 0 ? brief.interests.join(", ") : "general sightseeing"}`,
  ];

  if (brief.budget_amount !== null) {
    lines.push(`- Budget: ${brief.budget_amount} ${brief.budget_currency ?? "(currency unspecified)"}`);
    lines.push(`  Includes flights: ${brief.budget_includes_flights ? "yes" : "no"}`);
  }

  if (brief.dietary.length > 0) lines.push(`- Dietary: ${brief.dietary.join(", ")}`);
  if (brief.mobility_needs.length > 0) lines.push(`- Mobility: ${brief.mobility_needs.join(", ")}`);

  lines.push(``);
  lines.push(`Itinerary (validated — all facts are sourced):`);
  lines.push(JSON.stringify(itinerary, null, 2));

  if (softNotes && softNotes.length > 0) {
    lines.push(``);
    lines.push(`Advisory notes from the review (weave relevant ones naturally):`);
    for (const note of softNotes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

export async function runWriter(input: WriterInput): Promise<WriterOutput> {
  return runAgent({
    name: "writer",
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    schema: WriterOutputSchema,
    model: MODELS.fast,
  });
}
