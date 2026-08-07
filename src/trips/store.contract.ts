import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TRIP_SCHEMA_VERSION,
  type CritiqueResult,
  type Destination,
  type Itinerary,
  type TripBrief,
  type WriterOutput,
} from "../schemas/index.js";
import type { TripRecordInput, TripStore, Viewer } from "./store.js";

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../__fixtures__/golden-meghalaya-run.json"), "utf-8"),
) as {
  brief: TripBrief;
  destinations: Destination[];
  itinerary: Itinerary;
  critique: CritiqueResult;
  revisionsUsed: number;
};

/**
 * Defaults to null prose, which is the honest default: the golden fixture
 * predates the Writer, and a run whose Writer stage failed stores null too.
 * The prose round-trip is asserted explicitly by its own case below.
 *
 * Defaults to `userId: null` — an anonymous trip, which is still how every run
 * from a signed-out browser arrives (D9's dual ownership).
 */
function makeTrip(overrides: Partial<TripRecordInput> = {}): TripRecordInput {
  return {
    id: randomUUID(),
    ownerToken: randomUUID(),
    userId: null,
    status: "succeeded",
    schemaVersion: TRIP_SCHEMA_VERSION,
    request: "4 days in Meghalaya, BDT 45,000",
    brief: fixture.brief,
    destinations: fixture.destinations,
    itinerary: fixture.itinerary,
    critique: fixture.critique,
    writerOutput: null,
    revisionsUsed: fixture.revisionsUsed,
    ...overrides,
  };
}

const anon = (ownerToken: string): Viewer => ({ kind: "anonymous", ownerToken });
const asUser = (userId: string): Viewer => ({ kind: "user", userId });
const viaShare = (shareToken: string): Viewer => ({ kind: "share", shareToken });

const SAMPLE_PROSE: WriterOutput = {
  title: "4 Days in Meghalaya — Waterfalls & Root Bridges",
  summary: "You'll spend four days in the wettest place on earth.",
  sections: [{ heading: "Day 1 — Sohra", body: "Head to **Nohkalikai Falls**, which usually opens around 9." }],
  practical_tips: ["Pack a waterproof layer.", "Carry cash — cards are rarely accepted."],
  caveats: ["Opening hours are estimated, not confirmed — check before travelling."],
};

/**
 * Runs the same assertions against any TripStore implementation — the
 * in-memory fake (part of `npm test`) and NeonTripStore against a real
 * database (scripts/check-neon.test.ts, run manually). One divergence
 * between the two here would be the store equivalent of the schema/
 * projection drift already seen once in this project: green tests, broken
 * production path.
 *
 * That argument got sharper with D9. Ownership is now expressed twice — as
 * `isTripOwner` in JS and as a SQL predicate in NeonTripStore — because the
 * database has to enforce it inside the same statement as the UPDATE. Two
 * encodings of one access rule is exactly the kind of thing that drifts
 * silently and leaks another user's data when it does, so every authorization
 * case below runs against both.
 *
 * Cleanup tracks every viewer that could own a given trip (a claimed trip is no
 * longer deletable by the browser that created it) so a run against a real,
 * possibly shared Neon branch doesn't leave rows behind.
 */
export function tripStoreContractTests(
  label: string,
  createStore: () => TripStore | Promise<TripStore>,
  teardownStore?: (store: TripStore) => Promise<void> | void,
): void {
  describe(`TripStore contract (${label})`, () => {
    let store: TripStore;
    const created: { id: string; viewers: Viewer[] }[] = [];

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      while (created.length > 0) {
        const entry = created.pop()!;
        for (const viewer of entry.viewers) {
          if (await store.deleteTrip(entry.id, viewer)) break;
        }
      }
    });

    afterAll(async () => {
      if (teardownStore) await teardownStore(store);
    });

    function track(trip: TripRecordInput): TripRecordInput {
      const viewers: Viewer[] = [anon(trip.ownerToken)];
      if (trip.userId) viewers.push(asUser(trip.userId));
      created.push({ id: trip.id, viewers });
      return trip;
    }

    /** Registers an extra viewer that may end up owning a tracked trip, so a
     * claim inside a test doesn't strand the row. */
    function alsoOwnedBy(id: string, viewer: Viewer): void {
      created.find((entry) => entry.id === id)?.viewers.unshift(viewer);
    }

    // ---------------------------------------------------------------- storage

    it("returns null for an id that was never saved", async () => {
      expect(await store.getTrip(randomUUID(), anon(randomUUID()))).toBeNull();
    });

    it("round-trips a saved trip exactly, at the current schema version", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      expect(result?.ok).toBe(true);
      if (!result?.ok) throw new Error("expected ok result");
      expect(result.trip.id).toBe(trip.id);
      expect(result.trip.status).toBe("succeeded");
      expect(result.trip.brief).toEqual(fixture.brief);
      expect(result.trip.destinations).toEqual(fixture.destinations);
      expect(result.trip.itinerary).toEqual(fixture.itinerary);
      expect(result.trip.critique).toEqual(fixture.critique);
      expect(result.trip.revisionsUsed).toBe(fixture.revisionsUsed);
      expect(result.trip.writerOutput).toBeNull();
      expect(result.trip.title).toBeNull();
      expect(result.trip.isOwner).toBe(true);
    });

    // Prose is stored rather than regenerated: regenerating needs a live model
    // call and is non-deterministic, so a reopened trip would show different
    // prose than the traveller actually read (D8).
    it("round-trips the Writer's prose, including nested sections and caveats", async () => {
      const trip = track(makeTrip({ writerOutput: SAMPLE_PROSE }));
      await store.saveTrip(trip);

      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (!result?.ok) throw new Error("expected ok result");
      expect(result.trip.writerOutput).toEqual(SAMPLE_PROSE);
    });

    // A null here is a real state, not an absence of data: the run predates the
    // Writer, or its stage failed and was swallowed. It must survive as null
    // rather than becoming the JSONB scalar 'null' or undefined.
    it("distinguishes absent prose (null) from stored prose", async () => {
      const withProse = track(makeTrip({ writerOutput: SAMPLE_PROSE }));
      const without = track(makeTrip({ writerOutput: null }));
      await store.saveTrip(withProse);
      await store.saveTrip(without);

      const a = await store.getTrip(withProse.id, anon(withProse.ownerToken));
      const b = await store.getTrip(without.id, anon(without.ownerToken));
      if (!a?.ok || !b?.ok) throw new Error("expected ok results");
      expect(a.trip.writerOutput).not.toBeNull();
      expect(b.trip.writerOutput).toBeNull();
    });

    it("flags a schema_version mismatch as a read-only degraded summary, never a throw", async () => {
      const trip = track(makeTrip({ schemaVersion: TRIP_SCHEMA_VERSION - 1 }));
      await store.saveTrip(trip);

      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      expect(result?.ok).toBe(false);
      if (result?.ok !== false) throw new Error("expected a read-only result");
      expect(result.readOnly).toBe(true);
      expect(result.notice).toMatch(/older format/i);
      expect(result.summary.request).toBe(trip.request);
      expect(result.summary.destinationNames).toEqual(fixture.brief.destinations);
      expect(result.summary.dayCount).toBe(fixture.itinerary.days.length);
    });

    // ---------------------------------------------------------- authorization

    /**
     * The single most important assertion in this file. D9 replaced D7's
     * readable-by-id model with an access check, and "not yours" must be
     * indistinguishable from "does not exist" — anything else is an existence
     * oracle over other people's trip ids.
     */
    it("refuses a read by a different anonymous token, identically to a missing trip", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      expect(await store.getTrip(trip.id, anon(randomUUID()))).toBeNull();
      expect(await store.getTrip(randomUUID(), anon(randomUUID()))).toBeNull();
    });

    it("refuses a read of an anonymous trip by a signed-in user who does not own it", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      expect(await store.getTrip(trip.id, asUser(randomUUID()))).toBeNull();
    });

    it("lets the owning user read a user-owned trip and refuses every other user", async () => {
      const userId = randomUUID();
      const trip = track(makeTrip({ userId }));
      await store.saveTrip(trip);

      const mine = await store.getTrip(trip.id, asUser(userId));
      expect(mine?.ok).toBe(true);
      if (mine?.ok) expect(mine.trip.isOwner).toBe(true);

      expect(await store.getTrip(trip.id, asUser(randomUUID()))).toBeNull();
    });

    /**
     * Dual ownership has no both-owners state: once user_id is set, the browser
     * that created the trip stops being an owner. If this ever passed with the
     * owner token still working, "claim" would be a second key rather than a
     * transfer, and a shared machine would keep access to a claimed account's
     * trips forever.
     */
    it("stops honouring the owner token once a trip belongs to a user", async () => {
      const userId = randomUUID();
      const ownerToken = randomUUID();
      const trip = track(makeTrip({ ownerToken, userId }));
      await store.saveTrip(trip);

      expect(await store.getTrip(trip.id, anon(ownerToken))).toBeNull();
      expect(await store.getTrip(trip.id, asUser(userId))).not.toBeNull();
    });

    /**
     * The owner token is the exact bearer value claimTrips accepts. Echoing it
     * to a share reader would let someone who was legitimately shown a trip
     * attach it to their own account, so it is absent from the read type
     * entirely rather than stripped somewhere upstream.
     */
    it("never returns the owner token on a read", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (!result?.ok) throw new Error("expected ok result");
      expect((result.trip as unknown as Record<string, unknown>).ownerToken).toBeUndefined();
      expect(JSON.stringify(result.trip)).not.toContain(trip.ownerToken);
    });

    // ----------------------------------------------------------------- shares

    it("is unreadable by share token until one is set, and readable with it afterwards", async () => {
      const trip = track(makeTrip());
      const shareToken = randomUUID();
      await store.saveTrip(trip);

      expect(await store.getTrip(trip.id, viaShare(shareToken))).toBeNull();

      expect(await store.setShareToken(trip.id, anon(trip.ownerToken), shareToken)).toBe(true);
      const shared = await store.getTrip(trip.id, viaShare(shareToken));
      expect(shared?.ok).toBe(true);
    });

    it("refuses a wrong share token, and refuses every share token again after revocation", async () => {
      const trip = track(makeTrip());
      const shareToken = randomUUID();
      await store.saveTrip(trip);
      await store.setShareToken(trip.id, anon(trip.ownerToken), shareToken);

      expect(await store.getTrip(trip.id, viaShare(randomUUID()))).toBeNull();

      expect(await store.setShareToken(trip.id, anon(trip.ownerToken), null)).toBe(true);
      expect(await store.getTrip(trip.id, viaShare(shareToken))).toBeNull();
    });

    it("gives a share reader no ownership and no share token of its own", async () => {
      const trip = track(makeTrip());
      const shareToken = randomUUID();
      await store.saveTrip(trip);
      await store.setShareToken(trip.id, anon(trip.ownerToken), shareToken);

      const result = await store.getTrip(trip.id, viaShare(shareToken));
      if (!result?.ok) throw new Error("expected ok result");
      expect(result.trip.isOwner).toBe(false);
      expect(result.trip.shareToken).toBeNull();

      const owned = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (!owned?.ok) throw new Error("expected ok result");
      expect(owned.trip.shareToken).toBe(shareToken);
    });

    it("gives a share reader read access only — no delete, rename, or re-share", async () => {
      const trip = track(makeTrip());
      const shareToken = randomUUID();
      await store.saveTrip(trip);
      await store.setShareToken(trip.id, anon(trip.ownerToken), shareToken);

      expect(await store.renameTrip(trip.id, viaShare(shareToken), "mine now")).toBe(false);
      expect(await store.setShareToken(trip.id, viaShare(shareToken), randomUUID())).toBe(false);
      expect(await store.deleteTrip(trip.id, viaShare(shareToken))).toBe(false);

      // Still there, still named what its owner called it.
      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (!result?.ok) throw new Error("expected the trip to survive");
      expect(result.trip.title).toBeNull();
    });

    it("returns an empty list for a share viewer — a share token grants one trip, not a listing", async () => {
      const trip = track(makeTrip());
      const shareToken = randomUUID();
      await store.saveTrip(trip);
      await store.setShareToken(trip.id, anon(trip.ownerToken), shareToken);

      expect(await store.listTrips(viaShare(shareToken))).toEqual([]);
    });

    // ---------------------------------------------------------------- listing

    it("lists trips for an owner, most recent first, excluding other owners", async () => {
      const ownerToken = randomUUID();
      const other = randomUUID();
      const first = track(makeTrip({ ownerToken, request: "first trip" }));
      const second = track(makeTrip({ ownerToken, request: "second trip" }));
      const someoneElses = track(makeTrip({ ownerToken: other, request: "not mine" }));

      await store.saveTrip(first);
      await store.saveTrip(second);
      await store.saveTrip(someoneElses);

      const listed = await store.listTrips(anon(ownerToken));
      expect(listed.map((t) => t.id)).toEqual(
        [...listed].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => t.id),
      );
      expect(new Set(listed.map((t) => t.id))).toEqual(new Set([first.id, second.id]));
    });

    it("reports whether each listed trip currently has a share link", async () => {
      const ownerToken = randomUUID();
      const shared = track(makeTrip({ ownerToken }));
      const private_ = track(makeTrip({ ownerToken }));
      await store.saveTrip(shared);
      await store.saveTrip(private_);
      await store.setShareToken(shared.id, anon(ownerToken), randomUUID());

      const listed = await store.listTrips(anon(ownerToken));
      expect(listed.find((t) => t.id === shared.id)?.shared).toBe(true);
      expect(listed.find((t) => t.id === private_.id)?.shared).toBe(false);
    });

    // ---------------------------------------------------------------- claiming

    it("moves unclaimed trips to a user, and out of the anonymous list", async () => {
      const ownerToken = randomUUID();
      const userId = randomUUID();
      const trip = track(makeTrip({ ownerToken }));
      await store.saveTrip(trip);
      alsoOwnedBy(trip.id, asUser(userId));

      expect(await store.claimTrips(ownerToken, userId)).toBe(1);

      expect(await store.listTrips(anon(ownerToken))).toEqual([]);
      expect((await store.listTrips(asUser(userId))).map((t) => t.id)).toEqual([trip.id]);
    });

    it("claims only trips holding the presented token, and never another owner's", async () => {
      const mine = randomUUID();
      const theirs = randomUUID();
      const userId = randomUUID();
      const a = track(makeTrip({ ownerToken: mine }));
      const b = track(makeTrip({ ownerToken: theirs }));
      await store.saveTrip(a);
      await store.saveTrip(b);
      alsoOwnedBy(a.id, asUser(userId));

      expect(await store.claimTrips(mine, userId)).toBe(1);
      expect(await store.getTrip(b.id, asUser(userId))).toBeNull();
      expect(await store.getTrip(b.id, anon(theirs))).not.toBeNull();
    });

    /**
     * Claiming is trust-on-presentation (D9), so the one thing it must not do is
     * transfer a trip that already belongs to somebody. A leaked owner token can
     * cost its holder an unclaimed trip; it must not cost a second user theirs.
     */
    it("cannot re-claim a trip that already belongs to a user", async () => {
      const ownerToken = randomUUID();
      const firstUser = randomUUID();
      const attacker = randomUUID();
      const trip = track(makeTrip({ ownerToken, userId: firstUser }));
      await store.saveTrip(trip);

      expect(await store.claimTrips(ownerToken, attacker)).toBe(0);
      expect(await store.getTrip(trip.id, asUser(attacker))).toBeNull();
      expect(await store.getTrip(trip.id, asUser(firstUser))).not.toBeNull();
    });

    // ---------------------------------------------------------------- renaming

    it("renames a trip for its owner and shows the title in reads and listings", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      expect(await store.renameTrip(trip.id, anon(trip.ownerToken), "  Monsoon Meghalaya  ")).toBe(true);

      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (!result?.ok) throw new Error("expected ok result");
      expect(result.trip.title).toBe("Monsoon Meghalaya");

      const listed = await store.listTrips(anon(trip.ownerToken));
      expect(listed.find((t) => t.id === trip.id)?.title).toBe("Monsoon Meghalaya");
      // The original request text is kept alongside the title, not overwritten.
      expect(listed.find((t) => t.id === trip.id)?.request).toBe(trip.request);
    });

    it("treats a blank title as clearing the name rather than storing an empty label", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);
      await store.renameTrip(trip.id, anon(trip.ownerToken), "Named");

      expect(await store.renameTrip(trip.id, anon(trip.ownerToken), "   ")).toBe(true);
      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (!result?.ok) throw new Error("expected ok result");
      expect(result.trip.title).toBeNull();
    });

    it("refuses a rename by anyone but the owner", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      expect(await store.renameTrip(trip.id, anon(randomUUID()), "not yours")).toBe(false);
      expect(await store.renameTrip(trip.id, asUser(randomUUID()), "not yours")).toBe(false);
    });

    /** The title is a plain column, not part of the versioned agent payload, so
     * a renamed trip keeps its name even when the itinerary has degraded. */
    it("keeps the title on a read that degrades to a legacy summary", async () => {
      const trip = track(makeTrip({ schemaVersion: TRIP_SCHEMA_VERSION - 1 }));
      await store.saveTrip(trip);
      await store.renameTrip(trip.id, anon(trip.ownerToken), "Old Format Trip");

      const result = await store.getTrip(trip.id, anon(trip.ownerToken));
      if (result?.ok !== false) throw new Error("expected a read-only result");
      expect(result.title).toBe("Old Format Trip");
      expect(result.isOwner).toBe(true);
    });

    // ---------------------------------------------------------------- deleting

    it("deleteTrip requires ownership and is idempotent", async () => {
      const trip = track(makeTrip());
      await store.saveTrip(trip);

      expect(await store.deleteTrip(trip.id, anon(randomUUID()))).toBe(false);
      expect(await store.getTrip(trip.id, anon(trip.ownerToken))).not.toBeNull();

      expect(await store.deleteTrip(trip.id, anon(trip.ownerToken))).toBe(true);
      expect(await store.getTrip(trip.id, anon(trip.ownerToken))).toBeNull();

      // second delete: already gone, still a clean false rather than a throw
      expect(await store.deleteTrip(trip.id, anon(trip.ownerToken))).toBe(false);
    });
  });
}
