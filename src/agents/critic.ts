/**
 * The Critic agent. Itinerary + TripBrief -> CritiqueResult.
 *
 * verdict and hard_failures are computed by code, never the model's call —
 * checkItinerary() runs first, and the model receives its output as context
 * but its own schema (CritiqueJudgmentSchema) has no verdict or hard_failures
 * field at all. A model asked for a verdict eventually rationalizes "pass" on
 * an over-budget plan that reads well; that single failure mode would undo the
 * entire checks layer. `infeasible` isn't produced here either — it's
 * orchestrator.ts relabelling a `revise` once maxRevisionRounds is exhausted,
 * since round-counting is already that file's job.
 */

import { MODELS } from "../config.js";
import {
  CritiqueJudgmentSchema,
  type CheckFailure,
  type CritiqueResult,
  type Itinerary,
  type TripBrief,
} from "../schemas/index.js";
import { runAgent } from "./run.js";
import { checkItinerary } from "../checks/feasibility.js";

const SYSTEM_PROMPT = `You are the Critic agent in a travel planning pipeline.

Your job: add the qualitative judgement deterministic checks can't make, and
suggest concrete fixes. You are NOT deciding whether this itinerary passes.

RULES

1. Pass/fail is not your decision, and isn't part of what you return at all.
   You are shown hard_failures that code already computed — you cannot add to
   them, remove them, or override them. Do not restate them as your own
   soft_notes; they're already recorded.

2. soft_notes: things a human would notice that arithmetic can't catch — three
   museums in a row, nothing planned for the evening, a pace that doesn't
   match what the traveller actually asked for. An empty array is the correct
   answer for a genuinely good itinerary — don't invent a problem to fill it.

3. suggested_fixes: concrete and actionable. If hard_failures is non-empty,
   this itinerary is about to be revised — prioritize fixes that address those
   specific failures over general polish. If hard_failures is empty, fixes
   here are optional polish only.

OUTPUT

Return a single JSON object matching the required schema. No markdown, no
explanation before or after. JSON only.`;

function summarizeList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none stated";
}

function buildPrompt(
  itinerary: Itinerary,
  brief: TripBrief,
  hardFailures: CheckFailure[],
  notes: string[],
): string {
  return [
    `Traveller brief:`,
    `- pace: ${brief.pace}`,
    `- interests: ${summarizeList(brief.interests)}`,
    `- dietary: ${summarizeList(brief.dietary)}`,
    `- mobility needs: ${summarizeList(brief.mobility_needs)}`,
    ``,
    `Hard failures already found by deterministic checks (fixed — you cannot change these):`,
    hardFailures.length > 0 ? JSON.stringify(hardFailures, null, 2) : "(none)",
    ``,
    `Advisory notes from the same checks (informational, not failures):`,
    notes.length > 0 ? JSON.stringify(notes, null, 2) : "(none)",
    ``,
    `Itinerary:`,
    JSON.stringify(itinerary, null, 2),
  ].join("\n");
}

export interface CriticInput {
  itinerary: Itinerary;
  brief: TripBrief;
}

export async function runCritic(input: CriticInput): Promise<CritiqueResult> {
  const { itinerary, brief } = input;
  const { failures, notes: checkNotes } = checkItinerary(itinerary, brief);
  // construction_notes are code-only observations from ASSEMBLING the itinerary
  // (e.g. a requested month conflicting with a destination's best_months) —
  // they belong in the same non-blocking bucket as checkItinerary's own notes,
  // not a bucket of their own. See ItinerarySchema.construction_notes.
  const notes = [...itinerary.construction_notes, ...checkNotes];

  const judgment = await runAgent({
    name: "critic",
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildPrompt(itinerary, brief, failures, notes),
    schema: CritiqueJudgmentSchema,
    model: MODELS.reasoning,
  });

  return {
    verdict: failures.length > 0 ? "revise" : "pass",
    hard_failures: failures,
    soft_notes: [...notes, ...judgment.soft_notes],
    suggested_fixes: judgment.suggested_fixes,
  };
}
