import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRIP_SCHEMA_VERSION, type CritiqueResult, type Destination, type Itinerary, type TripBrief } from "../schemas/index.js";
import type { TripRecordInput, TripStore } from "./store.js";

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../__fixtures__/golden-meghalaya-run.json"), "utf-8"),
) as {
  brief: TripBrief;
  destinations: Destination[];
  itinerary: Itinerary;
  critique: CritiqueResult;
  revisionsUsed: number;
};

function makeTrip(overrides: Partial<TripRecordInput> = {}): TripRecordInput {
  return {
    id: randomUUID(),
    ownerToken: randomUUID(),
    status: "succeeded",
    schemaVersion: TRIP_SCHEMA_VERSION,
    request: "4 days in Meghalaya, BDT 45,000",
    brief: fixture.brief,
    destinations: fixture.destinations,
    itinerary: fixture.itinerary,
    critique: fixture.critique,
    revisionsUsed: fixture.revisionsUsed,
    ...overrides,
  };
}

/**
 * Runs the same assertions against any TripStore implementation — the
 * in-memory fake (part of `npm test`) and NeonTripStore against a real
 * database (scripts/check-neon.test.ts, run manually). One divergence
 * between the two here would be the store equivalent of the schema/
 * projection drift already seen once in this project: green tests, broken
 * production path. `createdIds` is tracked and cleaned up via deleteTrip so
 * a run against a real (possibly shared/branched) database doesn't leave
 * rows behind.
 */
export function tripStoreContractTests(
  label: string,
  createStore: () => TripStore | Promise<TripStore>,
  teardownStore?: (store: TripStore) => Promise<void> | void,
): void {
  describe(`TripStore contract (${label})`, () => {
    let store: TripStore;
    const createdIds: { id: string; ownerToken: string }[] = [];

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      while (createdIds.length > 0) {
        const entry = createdIds.pop()!;
        await store.deleteTrip(entry.id, entry.ownerToken);
      }
    });

    afterAll(async () => {
      if (teardownStore) await teardownStore(store);
    });

    function track(trip: TripRecordInput): TripRecordInput {
      createdIds.push({ id: trip.id, ownerToken: trip.ownerToken });
      return trip;
    }

    it("returns null for an id that was never saved", async () => {
      expect(await store.getTrip(randomUUID())).toBeNull();
    });

    it("round-trips a saved trip exactly, at the current schema version", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      const result = await store.getTrip(trip.id);
      expect(result?.ok).toBe(true);
      if (!result?.ok) throw new Error("expected ok result");
      expect(result.trip.id).toBe(trip.id);
      expect(result.trip.status).toBe("succeeded");
      expect(result.trip.brief).toEqual(fixture.brief);
      expect(result.trip.destinations).toEqual(fixture.destinations);
      expect(result.trip.itinerary).toEqual(fixture.itinerary);
      expect(result.trip.critique).toEqual(fixture.critique);
      expect(result.trip.revisionsUsed).toBe(fixture.revisionsUsed);
    });

    it("flags a schema_version mismatch as a read-only degraded summary, never a throw", async () => {
      const trip = track(makeTrip({ schemaVersion: TRIP_SCHEMA_VERSION - 1 }));
      await store.saveTrip(trip);

      const result = await store.getTrip(trip.id);
      expect(result?.ok).toBe(false);
      if (result?.ok !== false) throw new Error("expected a read-only result");
      expect(result.readOnly).toBe(true);
      expect(result.notice).toMatch(/older format/i);
      expect(result.summary.request).toBe(trip.request);
      expect(result.summary.destinationNames).toEqual(fixture.brief.destinations);
      expect(result.summary.dayCount).toBe(fixture.itinerary.days.length);
    });

    it("lists trips for an owner, most recent first, excluding other owners", async () => {
      const ownerToken = randomUUID();
      const other = randomUUID();
      const first = track(makeTrip({ ownerToken, request: "first trip" }));
      const second = track(makeTrip({ ownerToken, request: "second trip" }));
      const someoneElses = track(makeTrip({ ownerToken: other, request: "not mine" }));

      await store.saveTrip(first);
      await store.saveTrip(second);
      await store.saveTrip(someoneElses);

      const listed = await store.listTripsForOwner(ownerToken);
      expect(listed.map((t) => t.id)).toEqual(
        [...listed].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => t.id),
      );
      expect(new Set(listed.map((t) => t.id))).toEqual(new Set([first.id, second.id]));
    });

    it("deleteTrip requires a matching owner_token and is idempotent", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      expect(await store.deleteTrip(trip.id, "wrong-token")).toBe(false);
      expect(await store.getTrip(trip.id)).not.toBeNull();

      expect(await store.deleteTrip(trip.id, trip.ownerToken)).toBe(true);
      expect(await store.getTrip(trip.id)).toBeNull();

      // second delete: already gone, still a clean false rather than a throw
      expect(await store.deleteTrip(trip.id, trip.ownerToken)).toBe(false);
    });
  });
}
