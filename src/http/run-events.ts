import type { PipelineResult, ProgressEvent } from "../orchestrator.js";
import { RunEventSchema, type RunEvent } from "../schemas/index.js";

interface EventContext {
  runId: string;
  nextSeq: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function makeRunStartedEvent(context: EventContext, request: string, today: string): RunEvent {
  return RunEventSchema.parse({
    kind: "run_started",
    run_id: context.runId,
    seq: context.nextSeq,
    timestamp: nowIso(),
    request,
    today,
  });
}

export function projectProgressEvent(context: EventContext, progress: ProgressEvent): RunEvent {
  const base = {
    run_id: context.runId,
    seq: context.nextSeq,
    timestamp: nowIso(),
  };

  if (progress.destination) {
    return RunEventSchema.parse({
      ...base,
      kind: "destination_progress",
      stage: "guide",
      destination: progress.destination,
      index: progress.destinationIndex ?? 0,
      total: progress.destinationTotal ?? 1,
      status: progress.status,
      message: progress.message,
    });
  }

  return RunEventSchema.parse({
    ...base,
    kind: "stage_progress",
    stage: progress.stage,
    status: progress.status,
    message: progress.message,
    revision_round: progress.revisionRound ?? null,
  });
}

export function makeRunSucceededEvent(context: EventContext, result: PipelineResult): RunEvent {
  return RunEventSchema.parse({
    kind: "run_succeeded",
    run_id: context.runId,
    seq: context.nextSeq,
    timestamp: nowIso(),
    payload: {
      brief: result.brief,
      destinations: result.destinations,
      itinerary: result.itinerary,
      critique: result.critique,
      revisions_used: result.revisionsUsed,
      writer_output: result.writerOutput ?? null,
    },
  });
}

export function makeRunInfeasibleEvent(context: EventContext, result: PipelineResult): RunEvent {
  return RunEventSchema.parse({
    kind: "run_infeasible",
    run_id: context.runId,
    seq: context.nextSeq,
    timestamp: nowIso(),
    payload: {
      brief: result.brief,
      destinations: result.destinations,
      itinerary: result.itinerary,
      critique: result.critique,
      revisions_used: result.revisionsUsed,
    },
  });
}

export function makeRunBlockedEvent(context: EventContext, message: string, openQuestions: string[]): RunEvent {
  return RunEventSchema.parse({
    kind: "run_blocked",
    run_id: context.runId,
    seq: context.nextSeq,
    timestamp: nowIso(),
    message,
    open_questions: openQuestions,
  });
}

export function makeRunFailedEvent(context: EventContext, stage: ProgressEvent["stage"] | null, message: string, retryable?: boolean): RunEvent {
  return RunEventSchema.parse({
    kind: "run_failed",
    run_id: context.runId,
    seq: context.nextSeq,
    timestamp: nowIso(),
    stage,
    message,
    ...(retryable !== undefined ? { retryable } : {}),
  });
}
