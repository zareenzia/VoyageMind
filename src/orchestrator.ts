/**
 * Wires the pipeline together: Intake -> Guide (parallel, capped) -> Itinerary
 * <-> Critic (capped revision loop). Writer is Phase 1 (spec §7.1/§11) — this
 * ends at a validated Itinerary + CritiqueResult, not user-facing prose.
 *
 * Emits progress events from day one (CLAUDE.md rule 11), even for the CLI: a
 * 30-90s pipeline (measured — spec §10) with no feedback looks hung, not slow.
 * Built as a plain EventEmitter so the CLI renders it as text today and a
 * Phase 1 SSE endpoint can attach its own listener later without touching this
 * file.
 */

import { EventEmitter } from "node:events";
import { LIMITS } from "./config.js";
import { runIntake } from "./agents/intake.js";
import { researchDestination } from "./agents/research.js";
import { runItinerary } from "./agents/itinerary.js";
import { runCritic } from "./agents/critic.js";
import { runWriter } from "./agents/writer.js";
import type { CritiqueResult, Destination, Itinerary, TripBrief, WriterOutput } from "./schemas/index.js";

export interface ProgressEvent {
  stage: "intake" | "guide" | "itinerary" | "critic" | "writer";
  status: "started" | "completed" | "failed";
  message: string;
  destination?: string;
  destinationIndex?: number;
  destinationTotal?: number;
  revisionRound?: number;
}

/** The brief itself says the pipeline can't proceed (no destination, no trip
 * length) — not an agent failure. See the Itinerary agent's own nights===null
 * guard; this is the same gap, caught one stage earlier where it belongs. */
export class PipelineBlockedError extends Error {
  constructor(
    message: string,
    readonly openQuestions: string[],
  ) {
    super(message);
    this.name = "PipelineBlockedError";
  }
}

export interface PipelineResult {
  brief: TripBrief;
  destinations: Destination[];
  itinerary: Itinerary;
  critique: CritiqueResult;
  revisionsUsed: number;
  writerOutput: WriterOutput | null;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. An item that
 * throws resolves to `null` (after calling `onError`) rather than aborting the
 * rest — one bad destination (a geocode miss, a dead Overpass query) shouldn't
 * sink an otherwise-fine multi-destination trip.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onError?: (item: T, index: number, error: unknown) => void,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (error) {
        onError?.(items[i]!, i, error);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Pure — given a fresh critique and how many revisions have already been
 * spent, decides what happens next. Never model-decided: this is exactly what
 * CLAUDE.md rule 4 and "Maximum 2 revision rounds, enforced in orchestrator.ts"
 * mean concretely. The Critic agent itself only ever returns pass/revise;
 * `infeasible` is applied here, once, the moment revisions run out.
 */
export function decideNextStep(
  critique: CritiqueResult,
  revisionsUsed: number,
): { action: "pass" | "revise" | "infeasible"; critique: CritiqueResult } {
  if (critique.verdict === "pass") return { action: "pass", critique };
  if (revisionsUsed >= LIMITS.maxRevisionRounds) {
    return { action: "infeasible", critique: { ...critique, verdict: "infeasible" } };
  }
  return { action: "revise", critique };
}

/**
 * Returns immediately with an event emitter and a pending result — attach
 * listeners to `events` before awaiting `result`. The pipeline yields once
 * before its first emission specifically so that ordering is safe (see the
 * `await Promise.resolve()` in runPipelineInternal).
 */
export function runPipeline(
  request: string,
  today: string,
): { events: EventEmitter; result: Promise<PipelineResult> } {
  const events = new EventEmitter();
  const result = runPipelineInternal(request, today, events);
  return { events, result };
}

async function runPipelineInternal(
  request: string,
  today: string,
  events: EventEmitter,
): Promise<PipelineResult> {
  await Promise.resolve(); // yield once so the caller can attach listeners first

  const emit = (event: ProgressEvent) => events.emit("progress", event);

  emit({ stage: "intake", status: "started", message: "Reading the request..." });
  const brief = await runIntake({ request, today });
  emit({
    stage: "intake",
    status: "completed",
    message: `Extracted brief for: ${brief.destinations.join(", ") || "(no destination named)"}.`,
  });

  if (brief.destinations.length === 0 || brief.nights === null) {
    const missing = [
      brief.destinations.length === 0 ? "a destination" : null,
      brief.nights === null ? "trip length (nights)" : null,
    ].filter((v): v is string => v !== null);
    const message =
      `Cannot continue: missing ${missing.join(" and ")}. ` +
      (brief.open_questions.length > 0
        ? `Open questions: ${brief.open_questions.join("; ")}`
        : "Ask the traveller directly.");
    emit({ stage: "intake", status: "failed", message });
    throw new PipelineBlockedError(message, brief.open_questions);
  }

  emit({
    stage: "guide",
    status: "started",
    message: `Researching ${brief.destinations.length} destination(s)...`,
  });
  const destinationResults = await mapWithConcurrency(
    brief.destinations,
    LIMITS.maxParallelResearch,
    async (name, i) => {
      emit({
        stage: "guide",
        status: "started",
        message: `Researching destination "${name}"...`,
        destination: name,
        destinationIndex: i,
        destinationTotal: brief.destinations.length,
      });
      const researched = await researchDestination(brief, name);
      emit({
        stage: "guide",
        status: "completed",
        message: `Finished destination "${name}".`,
        destination: name,
        destinationIndex: i,
        destinationTotal: brief.destinations.length,
      });
      return researched;
    },
    (name, i, error) => {
      emit({
        stage: "guide",
        status: "failed",
        message: `Could not research "${name}": ${(error as Error).message}`,
        destination: name,
        destinationIndex: i,
        destinationTotal: brief.destinations.length,
      });
    },
  );
  const destinations = destinationResults.filter((d): d is Destination => d !== null);
  if (destinations.length === 0) {
    const message = "Could not research any of the named destinations.";
    emit({ stage: "guide", status: "failed", message });
    throw new Error(message);
  }
  emit({
    stage: "guide",
    status: "completed",
    message: `Researched ${destinations.length}/${brief.destinations.length} destination(s).`,
  });

  emit({ stage: "itinerary", status: "started", message: "Building the itinerary...", revisionRound: 0 });
  let itinerary = await runItinerary({ brief, destinations, today });
  emit({
    stage: "itinerary",
    status: "completed",
    message: itinerary.brief_summary,
    revisionRound: 0,
  });

  let revisionsUsed = 0;
  let critique: CritiqueResult;
  for (;;) {
    emit({
      stage: "critic",
      status: "started",
      message: `Reviewing (${revisionsUsed} revision(s) used so far)...`,
      revisionRound: revisionsUsed,
    });
    critique = await runCritic({ itinerary, brief });
    emit({
      stage: "critic",
      status: "completed",
      message: `Verdict: ${critique.verdict} (${critique.hard_failures.length} hard failure(s)).`,
      revisionRound: revisionsUsed,
    });

    const decision = decideNextStep(critique, revisionsUsed);
    critique = decision.critique;
    if (decision.action !== "revise") break;

    revisionsUsed++;
    emit({
      stage: "itinerary",
      status: "started",
      message: `Revising (round ${revisionsUsed})...`,
      revisionRound: revisionsUsed,
    });
    itinerary = await runItinerary({
      brief,
      destinations,
      today,
      revision: { previousItinerary: itinerary, critique },
    });
    emit({
      stage: "itinerary",
      status: "completed",
      message: itinerary.brief_summary,
      revisionRound: revisionsUsed,
    });
  }

  // Writer stage — only runs when the itinerary is valid (not infeasible)
  let writerOutput: WriterOutput | null = null;
  if (critique.verdict === "pass") {
    emit({ stage: "writer", status: "started", message: "Writing your travel plan..." });
    try {
      writerOutput = await runWriter({
        itinerary,
        brief,
        softNotes: critique.soft_notes,
      });
      emit({ stage: "writer", status: "completed", message: "Travel plan written." });
    } catch (error) {
      emit({
        stage: "writer",
        status: "failed",
        message: `Writer failed: ${(error as Error).message}`,
      });
      // Non-fatal: the pipeline result is still valid without prose
    }
  }

  return { brief, destinations, itinerary, critique, revisionsUsed, writerOutput };
}
