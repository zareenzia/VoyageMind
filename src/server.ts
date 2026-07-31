import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import { LIMITS } from "./config.js";
import { PipelineBlockedError, runPipeline, type PipelineResult, type ProgressEvent } from "./orchestrator.js";
import {
  makeRunBlockedEvent,
  makeRunFailedEvent,
  makeRunInfeasibleEvent,
  makeRunStartedEvent,
  makeRunSucceededEvent,
  projectProgressEvent,
} from "./http/run-events.js";
import { TRIP_SCHEMA_VERSION, type RunEvent } from "./schemas/index.js";
import { InMemoryRunStore } from "./runs/store.js";
import { NeonTripStore } from "./trips/neon-store.js";

const PORT = Number(process.env.PORT ?? "8787");
const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 60_000;

const CreateRunBodySchema = z.object({
  request: z.string().min(1),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Anonymous, client-generated (localStorage) — filters "my trips", never an
  // access check. See docs/VOYAGEMIND_SPEC.md D7.
  owner_token: z.string().min(1),
});

const runStore = new InMemoryRunStore();
const tripStore = new NeonTripStore();
const subscribers = new Map<string, Set<(event: RunEvent) => void>>();

/**
 * Only run_succeeded/run_infeasible reach here — the two terminal kinds that
 * carry a payload with a real Itinerary (see server's startRun). A storage
 * failure must never affect the run the client already saw over SSE: it's
 * caught here, not rethrown, so the only consequence is a missing "my trips"
 * entry — which is otherwise silent, hence logging loudly.
 */
async function persistTrip(
  runId: string,
  ownerToken: string,
  request: string,
  status: "succeeded" | "infeasible",
  pipelineResult: PipelineResult,
): Promise<void> {
  try {
    await tripStore.saveTrip({
      id: runId,
      ownerToken,
      status,
      schemaVersion: TRIP_SCHEMA_VERSION,
      request,
      brief: pipelineResult.brief,
      destinations: pipelineResult.destinations,
      itinerary: pipelineResult.itinerary,
      critique: pipelineResult.critique,
      revisionsUsed: pipelineResult.revisionsUsed,
    });
  } catch (error) {
    console.error(
      `[trips] failed to persist trip ${runId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isTerminal(event: RunEvent): boolean {
  return event.kind === "run_succeeded" || event.kind === "run_blocked" || event.kind === "run_failed" || event.kind === "run_infeasible";
}

function getSubscribers(runId: string): Set<(event: RunEvent) => void> {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  return set;
}

function appendAndPublish(runId: string, event: RunEvent): void {
  runStore.appendEvent(runId, event);
  const set = subscribers.get(runId);
  if (!set) return;
  for (const listener of set) {
    listener(event);
  }
}

function writeJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(text, "utf8"));
  res.end(text);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function toSseFrame(event: RunEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseLastEventId(header: string | string[] | undefined): number {
  if (Array.isArray(header)) return parseLastEventId(header[0]);
  if (header === undefined) return -1;
  const parsed = Number.parseInt(header, 10);
  return Number.isInteger(parsed) ? parsed : -1;
}

function startRun(runId: string, ownerToken: string, request: string, today: string): void {
  let nextSeq = 0;
  let latestStage: ProgressEvent["stage"] | null = null;
  let terminalEmitted = false;
  const next = () => {
    const seq = nextSeq;
    nextSeq++;
    return seq;
  };

  appendAndPublish(runId, makeRunStartedEvent({ runId, nextSeq: next() }, request, today));

  const { events, result } = runPipeline(request, today);
  events.on("progress", (progress: ProgressEvent) => {
    latestStage = progress.stage;
    appendAndPublish(runId, projectProgressEvent({ runId, nextSeq: next() }, progress));
  });

  void (async () => {
    try {
      const pipelineResult = await result;
      if (pipelineResult.critique.verdict === "infeasible") {
        appendAndPublish(runId, makeRunInfeasibleEvent({ runId, nextSeq: next() }, pipelineResult));
        await persistTrip(runId, ownerToken, request, "infeasible", pipelineResult);
      } else {
        appendAndPublish(runId, makeRunSucceededEvent({ runId, nextSeq: next() }, pipelineResult));
        await persistTrip(runId, ownerToken, request, "succeeded", pipelineResult);
      }
      terminalEmitted = true;
    } catch (error) {
      if (error instanceof PipelineBlockedError) {
        appendAndPublish(
          runId,
          makeRunBlockedEvent({ runId, nextSeq: next() }, error.message, error.openQuestions),
        );
      } else {
        const message = error instanceof Error ? error.message : String(error);
        appendAndPublish(runId, makeRunFailedEvent({ runId, nextSeq: next() }, latestStage, message));
      }
      terminalEmitted = true;
    } finally {
      if (!terminalEmitted) {
        appendAndPublish(
          runId,
          makeRunFailedEvent({ runId, nextSeq: next() }, latestStage, "Run exited without a terminal event."),
        );
      }
    }
  })();
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    writeJson(res, 400, { error: "Bad request" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "POST" && url.pathname === "/runs") {
    let bodyText = "";
    try {
      bodyText = await readBody(req);
      const parsed = CreateRunBodySchema.parse(JSON.parse(bodyText));
      const runId = randomUUID();
      runStore.createRun(runId);
      const today = parsed.today ?? new Date().toISOString().slice(0, 10);
      startRun(runId, parsed.owner_token, parsed.request, today);
      writeJson(res, 200, { run_id: runId });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON body";
      writeJson(res, 400, { error: message });
      return;
    }
  }

  const match = url.pathname.match(/^\/runs\/([0-9a-fA-F-]{36})\/events$/);
  if (req.method === "GET" && match) {
    const runId = match[1];
    if (!runId) {
      writeJson(res, 404, { error: "Unknown run_id" });
      return;
    }
    if (!runStore.runExists(runId)) {
      writeJson(res, 404, { error: "Unknown run_id" });
      return;
    }

    const lastEventId = parseLastEventId(req.headers["last-event-id"]);
    const replay = runStore.getEventsAfter(runId, lastEventId);

    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();

    for (const event of replay) {
      res.write(toSseFrame(event));
    }

    const lastReplayed = replay[replay.length - 1];
    if (lastReplayed && isTerminal(lastReplayed)) {
      res.end();
      return;
    }

    const listener = (event: RunEvent) => {
      res.write(toSseFrame(event));
      if (isTerminal(event)) {
        cleanup();
        res.end();
      }
    };

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      const set = subscribers.get(runId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) subscribers.delete(runId);
    };

    getSubscribers(runId).add(listener);
    req.on("close", cleanup);
    return;
  }

  // Lightweight existence check — used by the client to distinguish
  // "run gone" (404) from "transient network issue" on EventSource error.
  const existsMatch = url.pathname.match(/^\/runs\/([0-9a-fA-F-]{36})$/);
  if (req.method === "GET" && existsMatch) {
    const runId = existsMatch[1];
    if (runId && runStore.runExists(runId)) {
      writeJson(res, 200, { run_id: runId, exists: true });
    } else {
      writeJson(res, 404, { error: "Unknown run_id" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/trips") {
    const ownerToken = url.searchParams.get("owner_token");
    if (!ownerToken) {
      writeJson(res, 400, { error: "owner_token query parameter is required" });
      return;
    }
    try {
      const trips = await tripStore.listTripsForOwner(ownerToken);
      writeJson(res, 200, { trips });
    } catch (error) {
      console.error(`[trips] failed to list trips: ${error instanceof Error ? error.message : String(error)}`);
      writeJson(res, 502, { error: "Could not load trips right now." });
    }
    return;
  }

  const tripMatch = url.pathname.match(/^\/trips\/([0-9a-fA-F-]{36})$/);
  if (tripMatch) {
    const tripId = tripMatch[1]!;

    if (req.method === "GET") {
      try {
        const result = await tripStore.getTrip(tripId);
        if (!result) {
          writeJson(res, 404, { error: "Unknown trip" });
          return;
        }
        writeJson(res, 200, result);
      } catch (error) {
        console.error(`[trips] failed to read trip ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not load this trip right now." });
      }
      return;
    }

    if (req.method === "DELETE") {
      const ownerToken = url.searchParams.get("owner_token");
      if (!ownerToken) {
        writeJson(res, 400, { error: "owner_token query parameter is required" });
        return;
      }
      try {
        const deleted = await tripStore.deleteTrip(tripId, ownerToken);
        if (!deleted) {
          writeJson(res, 404, { error: "Unknown trip, or owner_token did not match" });
          return;
        }
        writeJson(res, 200, { deleted: true });
      } catch (error) {
        console.error(`[trips] failed to delete trip ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not delete this trip right now." });
      }
      return;
    }
  }

  writeJson(res, 404, { error: "Not found" });
});

setInterval(() => {
  for (const { runId, nextSeq } of runStore.getAbandonedRuns()) {
    appendAndPublish(
      runId,
      makeRunFailedEvent(
        { runId, nextSeq },
        null,
        "Run abandoned: no progress for " + LIMITS.runAbandonedMinutes + " minutes. You can retry the request.",
        true,
      ),
    );
  }
  runStore.sweepExpired();
}, SWEEP_MS);

server.listen(PORT, () => {
  console.log(`VoyageMind server listening on http://localhost:${PORT}`);
});
