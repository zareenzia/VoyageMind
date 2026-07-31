import { describe, expect, it } from "vitest";
import { InMemoryRunStore } from "./store.js";
import type { RunEvent } from "../schemas/index.js";

const RUN_ID = "90d8f990-4bc7-4339-a481-70f56f5a4d77";
const BASE_TIME = "2026-07-31T00:00:00.000Z";

function startedEvent(seq: number): RunEvent {
  return {
    kind: "run_started",
    run_id: RUN_ID,
    seq,
    timestamp: BASE_TIME,
    request: "4 days in Meghalaya, BDT 45,000",
    today: "2026-07-31",
  };
}

function stageEvent(seq: number): RunEvent {
  return {
    kind: "stage_progress",
    run_id: RUN_ID,
    seq,
    timestamp: BASE_TIME,
    stage: "intake",
    status: "started",
    message: "Reading request",
    revision_round: 0,
  };
}

function terminalEvent(seq: number): RunEvent {
  return {
    kind: "run_failed",
    run_id: RUN_ID,
    seq,
    timestamp: "2026-07-31T00:02:00.000Z",
    stage: "guide",
    message: "something broke",
  };
}

describe("InMemoryRunStore", () => {
  it("stores events in seq order and replays after a Last-Event-ID seq", () => {
    const store = new InMemoryRunStore();
    store.createRun(RUN_ID);
    store.appendEvent(RUN_ID, startedEvent(0));
    store.appendEvent(RUN_ID, stageEvent(1));

    const replay = store.getEventsAfter(RUN_ID, 0);
    expect(replay).toHaveLength(1);
    expect(replay[0]?.seq).toBe(1);
    expect(replay[0]?.kind).toBe("stage_progress");
  });

  it("returns empty for unknown run IDs and exposes runExists()", () => {
    const store = new InMemoryRunStore();
    expect(store.runExists(RUN_ID)).toBe(false);
    expect(store.getEventsAfter(RUN_ID, -1)).toEqual([]);
  });

  it("rejects a second terminal event", () => {
    const store = new InMemoryRunStore();
    store.createRun(RUN_ID);
    store.appendEvent(RUN_ID, startedEvent(0));
    store.appendEvent(RUN_ID, terminalEvent(1));

    expect(() => store.appendEvent(RUN_ID, terminalEvent(2))).toThrow("Run already terminal");
  });

  it("evicts terminal runs after runRetentionMinutes", () => {
    const originalNow = Date.now;
    let nowMs = Date.parse("2026-07-31T00:00:00.000Z");
    Date.now = () => nowMs;

    try {
      const store = new InMemoryRunStore();
      store.createRun(RUN_ID);
      store.appendEvent(RUN_ID, startedEvent(0));
      store.appendEvent(RUN_ID, terminalEvent(1));
      expect(store.runExists(RUN_ID)).toBe(true);

      nowMs = Date.parse("2026-07-31T00:09:59.000Z");
      expect(store.sweepExpired()).toBe(0);
      expect(store.runExists(RUN_ID)).toBe(true);

      nowMs = Date.parse("2026-07-31T00:12:00.000Z");
      expect(store.sweepExpired()).toBe(1);
      expect(store.runExists(RUN_ID)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it("evicts non-terminal runs after runAbsoluteMaxMinutes", () => {
    const originalNow = Date.now;
    let nowMs = Date.parse("2026-07-31T00:00:00.000Z");
    Date.now = () => nowMs;

    try {
      const store = new InMemoryRunStore();
      store.createRun(RUN_ID);
      store.appendEvent(RUN_ID, startedEvent(0));

      nowMs = Date.parse("2026-07-31T00:29:59.000Z");
      expect(store.sweepExpired()).toBe(0);
      expect(store.runExists(RUN_ID)).toBe(true);

      nowMs = Date.parse("2026-07-31T00:30:00.000Z");
      expect(store.sweepExpired()).toBe(1);
      expect(store.runExists(RUN_ID)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it("identifies abandoned non-terminal runs based on time since last event", () => {
    const originalNow = Date.now;
    let nowMs = Date.parse("2026-07-31T00:00:00.000Z");
    Date.now = () => nowMs;

    try {
      const store = new InMemoryRunStore();
      store.createRun(RUN_ID);
      store.appendEvent(RUN_ID, startedEvent(0));
      store.appendEvent(RUN_ID, stageEvent(1));

      // 4 minutes later — not yet abandoned
      nowMs = Date.parse("2026-07-31T00:04:00.000Z");
      expect(store.getAbandonedRuns()).toEqual([]);

      // 5 minutes after the last event — now abandoned
      nowMs = Date.parse("2026-07-31T00:05:00.000Z");
      const abandoned = store.getAbandonedRuns();
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0]?.runId).toBe(RUN_ID);
      expect(abandoned[0]?.nextSeq).toBe(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not mark terminal runs as abandoned", () => {
    const originalNow = Date.now;
    let nowMs = Date.parse("2026-07-31T00:00:00.000Z");
    Date.now = () => nowMs;

    try {
      const store = new InMemoryRunStore();
      store.createRun(RUN_ID);
      store.appendEvent(RUN_ID, startedEvent(0));
      store.appendEvent(RUN_ID, terminalEvent(1));

      // Well past the abandoned threshold, but already terminal
      nowMs = Date.parse("2026-07-31T00:08:00.000Z");
      expect(store.getAbandonedRuns()).toEqual([]);
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not mark a run as abandoned if a recent event arrived", () => {
    const originalNow = Date.now;
    let nowMs = Date.parse("2026-07-31T00:00:00.000Z");
    Date.now = () => nowMs;

    try {
      const store = new InMemoryRunStore();
      store.createRun(RUN_ID);
      store.appendEvent(RUN_ID, startedEvent(0));

      // 4.5 min later, a new event arrives
      nowMs = Date.parse("2026-07-31T00:04:30.000Z");
      store.appendEvent(RUN_ID, {
        ...stageEvent(1),
        timestamp: "2026-07-31T00:04:30.000Z",
      });

      // 4 min after THAT event — not yet abandoned (only 4 min since last event)
      nowMs = Date.parse("2026-07-31T00:08:30.000Z");
      expect(store.getAbandonedRuns()).toEqual([]);

      // 5 min after that event — now abandoned
      nowMs = Date.parse("2026-07-31T00:09:30.000Z");
      expect(store.getAbandonedRuns()).toHaveLength(1);
    } finally {
      Date.now = originalNow;
    }
  });
});
