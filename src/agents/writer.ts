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

1. NEVER invent information. Every place, time, cost, and fact in your output
   must come from the itinerary you were given. If the itinerary says a place
   opens at 09:00, you say 09:00 — not "early morning." If a cost is marked as
   estimated, you may note that, but never replace it with a different number.

2. Write in second person ("you'll visit...", "head to..."). Warm, confident,
   practical. Not a brochure — a knowledgeable friend who planned this for you.

3. Structure:
   - title: catchy but informative trip title
   - summary: 2-3 paragraphs capturing the trip's essence, highlights, and vibe
   - sections: one per day (heading like "Day 1 — Base City: Key Highlight"),
     each reading as a flowing narrative that weaves the stops together naturally.
     Include transition language between stops. Mention specific times as anchors
     ("arrive by 9 AM to beat the crowds") but don't make it read like a
     timetable.
   - practical_tips: 5-10 short, actionable items (packing, transport, money,
     safety, cultural notes)

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
