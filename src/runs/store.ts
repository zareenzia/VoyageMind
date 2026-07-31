import { LIMITS } from "../config.js";
import { RunEventSchema, type RunEvent, type RunTerminalEvent } from "../schemas/index.js";

interface StoredRun {
  events: RunEvent[];
  createdAtMs: number;
  lastEventAtMs: number;
  terminalAtMs: number | null;
}

export interface AbandonedRunInfo {
  runId: string;
  nextSeq: number;
}

export interface RunStore {
  createRun(runId: string): void;
  runExists(runId: string): boolean;
  appendEvent(runId: string, event: RunEvent): void;
  getEventsAfter(runId: string, lastSeenSeq: number): RunEvent[];
  getAbandonedRuns(nowMs?: number): AbandonedRunInfo[];
  sweepExpired(nowMs?: number): number;
}

function isTerminalEvent(event: RunEvent): event is RunTerminalEvent {
  return event.kind === "run_succeeded" || event.kind === "run_blocked" || event.kind === "run_failed" || event.kind === "run_infeasible";
}

function eventTimeMs(event: RunEvent): number {
  return Date.parse(event.timestamp);
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredRun>();

  createRun(runId: string): void {
    if (this.runs.has(runId)) {
      throw new Error(`Run already exists: ${runId}`);
    }
    const nowMs = Date.now();
    this.runs.set(runId, { events: [], createdAtMs: nowMs, lastEventAtMs: nowMs, terminalAtMs: null });
  }

  runExists(runId: string): boolean {
    return this.runs.has(runId);
  }

  appendEvent(runId: string, event: RunEvent): void {
    const parsed = RunEventSchema.parse(event);
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }
    if (parsed.run_id !== runId) {
      throw new Error(`Event run_id mismatch: expected ${runId}, got ${parsed.run_id}`);
    }
    const expectedSeq = run.events.length;
    if (parsed.seq !== expectedSeq) {
      throw new Error(`Non-contiguous seq for run ${runId}: expected ${expectedSeq}, got ${parsed.seq}`);
    }
    if (run.terminalAtMs !== null) {
      throw new Error(`Run already terminal: ${runId}`);
    }

    run.events.push(parsed);
    run.lastEventAtMs = eventTimeMs(parsed);
    if (isTerminalEvent(parsed)) {
      run.terminalAtMs = eventTimeMs(parsed);
    }
  }

  getEventsAfter(runId: string, lastSeenSeq: number): RunEvent[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    return run.events.filter((event) => event.seq > lastSeenSeq);
  }

  getAbandonedRuns(nowMs: number = Date.now()): AbandonedRunInfo[] {
    const abandonedMs = LIMITS.runAbandonedMinutes * 60_000;
    const result: AbandonedRunInfo[] = [];
    for (const [runId, run] of this.runs.entries()) {
      if (run.terminalAtMs !== null) continue;
      if (run.events.length === 0) continue;
      if (nowMs - run.lastEventAtMs >= abandonedMs) {
        result.push({ runId, nextSeq: run.events.length });
      }
    }
    return result;
  }

  sweepExpired(nowMs: number = Date.now()): number {
    const retentionMs = LIMITS.runRetentionMinutes * 60_000;
    const absoluteMaxMs = LIMITS.runAbsoluteMaxMinutes * 60_000;
    let removed = 0;

    for (const [runId, run] of this.runs.entries()) {
      const ageMs = nowMs - run.createdAtMs;
      const terminalAgeMs = run.terminalAtMs === null ? 0 : nowMs - run.terminalAtMs;
      const beyondAbsoluteMax = ageMs >= absoluteMaxMs;
      const beyondTerminalRetention = run.terminalAtMs !== null && terminalAgeMs >= retentionMs;

      if (beyondAbsoluteMax || beyondTerminalRetention) {
        this.runs.delete(runId);
        removed++;
      }
    }

    return removed;
  }
}
