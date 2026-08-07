import { useCallback, useReducer, useRef } from "react";
import { RunEventSchema, type PipelineStage, type RunEvent } from "@shared/schemas/index.ts";
import { apiSend } from "../lib/api.ts";

// --- State types ---
//
// PipelineStage comes from the schema, never a local copy. It used to be
// hand-duplicated here as a four-stage union, which silently went stale the
// moment the Writer stage was added — and the frontend isn't covered by the
// root `npm run typecheck`, so nothing caught it. That is rule 1 ("schemas are
// the contract") failing in the one direction the rule exists to prevent.

interface DestinationStatus {
  name: string;
  index: number;
  status: "started" | "completed" | "failed";
}

interface RunProgress {
  currentStage: PipelineStage | null;
  stageStatuses: Record<PipelineStage, "pending" | "started" | "completed" | "failed">;
  destinations: DestinationStatus[];
  destinationTotal: number;
  revisionRound: number;
  startedAt: number | null;
}

type TerminalKind = "run_succeeded" | "run_infeasible" | "run_blocked" | "run_failed" | "connection_lost" | "run_expired";

interface RunTerminal {
  kind: TerminalKind;
  event: RunEvent | null;
}

export interface RunState {
  phase: "idle" | "running" | "reconnecting" | "terminal";
  runId: string | null;
  events: RunEvent[];
  progress: RunProgress;
  terminal: RunTerminal | null;
}

const INITIAL_PROGRESS: RunProgress = {
  currentStage: null,
  // Record<PipelineStage, …> — adding a stage to the schema now fails to compile
  // here until it is listed, which is the point.
  stageStatuses: {
    intake: "pending",
    guide: "pending",
    itinerary: "pending",
    critic: "pending",
    writer: "pending",
  },
  destinations: [],
  destinationTotal: 0,
  revisionRound: 0,
  startedAt: null,
};

const INITIAL_STATE: RunState = {
  phase: "idle",
  runId: null,
  events: [],
  progress: INITIAL_PROGRESS,
  terminal: null,
};

// --- Reducer ---

type RunAction =
  | { type: "start"; runId: string }
  | { type: "event"; event: RunEvent }
  | { type: "reconnecting" }
  | { type: "connection_lost" }
  | { type: "run_expired" }
  | { type: "reset" };

function reduceProgress(progress: RunProgress, event: RunEvent): RunProgress {
  switch (event.kind) {
    case "run_started":
      return { ...progress, startedAt: Date.parse(event.timestamp) };

    case "stage_progress": {
      const statuses = { ...progress.stageStatuses, [event.stage]: event.status };
      return {
        ...progress,
        currentStage: event.status === "started" ? event.stage : progress.currentStage,
        stageStatuses: statuses,
        revisionRound: event.revision_round ?? progress.revisionRound,
      };
    }

    case "destination_progress": {
      const existing = progress.destinations.find((d) => d.name === event.destination);
      const destinations = existing
        ? progress.destinations.map((d) =>
            d.name === event.destination ? { ...d, status: event.status } : d,
          )
        : [...progress.destinations, { name: event.destination, index: event.index, status: event.status }];
      return { ...progress, destinations, destinationTotal: event.total };
    }

    case "revision_progress":
      return { ...progress, revisionRound: event.round };

    default:
      return progress;
  }
}

function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "start":
      return { ...INITIAL_STATE, phase: "running", runId: action.runId };

    case "event": {
      const event = action.event;
      const events = [...state.events, event];
      const progress = reduceProgress(state.progress, event);

      if (
        event.kind === "run_succeeded" ||
        event.kind === "run_infeasible" ||
        event.kind === "run_blocked" ||
        event.kind === "run_failed"
      ) {
        return { ...state, phase: "terminal", events, progress, terminal: { kind: event.kind, event } };
      }

      return { ...state, events, progress };
    }

    case "reconnecting":
      return { ...state, phase: "reconnecting" };

    case "connection_lost":
      return { ...state, phase: "terminal", terminal: { kind: "connection_lost", event: null } };

    case "run_expired":
      return { ...state, phase: "terminal", terminal: { kind: "run_expired", event: null } };

    case "reset":
      return INITIAL_STATE;
  }
}

// --- Hook ---

const WATCHDOG_TIMEOUT_MS = 180_000; // Must exceed longest realistic stage gap (~73s observed)

export function useRun() {
  const [state, dispatch] = useReducer(runReducer, INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef<string | null>(null);

  const resetWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      // Only escalate if EventSource is NOT open — an open connection means
      // the stream is alive (server sends TCP-level pings the browser can't see).
      if (esRef.current && esRef.current.readyState === EventSource.OPEN) {
        // Connection is healthy, just a long gap — reset and wait more
        resetWatchdog();
        return;
      }
      esRef.current?.close();
      esRef.current = null;
      dispatch({ type: "connection_lost" });
    }, WATCHDOG_TIMEOUT_MS);
  }, []);

  const checkRunExists = useCallback(async (runId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/runs/${runId}`);
      return res.ok;
    } catch {
      return true; // Network error — assume run may still exist, keep trying
    }
  }, []);

  const subscribe = useCallback(
    (runId: string) => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      runIdRef.current = runId;

      const es = new EventSource(`/runs/${runId}/events`);
      esRef.current = es;
      resetWatchdog();

      const handleEvent = (e: MessageEvent) => {
        resetWatchdog();
        try {
          const parsed = RunEventSchema.parse(JSON.parse(e.data));
          dispatch({ type: "event", event: parsed });

          if (
            parsed.kind === "run_succeeded" ||
            parsed.kind === "run_infeasible" ||
            parsed.kind === "run_blocked" ||
            parsed.kind === "run_failed"
          ) {
            es.close();
            esRef.current = null;
            if (watchdogRef.current) clearTimeout(watchdogRef.current);
          }
        } catch {
          // Malformed event — ignore, rely on watchdog
        }
      };

      es.addEventListener("run_started", handleEvent);
      es.addEventListener("stage_progress", handleEvent);
      es.addEventListener("destination_progress", handleEvent);
      es.addEventListener("revision_progress", handleEvent);
      es.addEventListener("run_succeeded", handleEvent);
      es.addEventListener("run_infeasible", handleEvent);
      es.addEventListener("run_blocked", handleEvent);
      es.addEventListener("run_failed", handleEvent);

      es.onerror = () => {
        if (state.phase === "terminal") return;

        // readyState CLOSED means EventSource gave up permanently (e.g. 404 response).
        // Check if the run still exists on the server.
        if (es.readyState === EventSource.CLOSED) {
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          void checkRunExists(runId).then((exists) => {
            if (!exists) {
              dispatch({ type: "run_expired" });
            } else {
              dispatch({ type: "connection_lost" });
            }
          });
          return;
        }

        // readyState CONNECTING means EventSource is auto-reconnecting with Last-Event-ID
        dispatch({ type: "reconnecting" });
        resetWatchdog();
      };
    },
    [resetWatchdog, checkRunExists, state.phase],
  );

  const startRun = useCallback(
    async (request: string) => {
      dispatch({ type: "reset" });
      // The owner token and the session cookie are both attached by apiSend —
      // the server decides from them whether the resulting trip is anonymous or
      // belongs to an account, and it decides that now rather than when the
      // 90-second pipeline finishes.
      const { run_id } = await apiSend<{ run_id: string }>("POST", "/runs", { request });
      dispatch({ type: "start", runId: run_id });
      subscribe(run_id);
      return run_id;
    },
    [subscribe],
  );

  const rejoinRun = useCallback(
    (runId: string) => {
      dispatch({ type: "start", runId });
      subscribe(runId);
    },
    [subscribe],
  );

  return { state, startRun, rejoinRun };
}
