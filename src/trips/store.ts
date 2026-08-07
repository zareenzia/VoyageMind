import { z } from "zod";
import {
  CritiqueResultSchema,
  DestinationSchema,
  ItinerarySchema,
  TripBriefSchema,
  TRIP_SCHEMA_VERSION,
  WriterOutputSchema,
  type CritiqueResult,
  type Destination,
  type Itinerary,
  type TripBrief,
  type WriterOutput,
} from "../schemas/index.js";
import { extractLegacySummary, LEGACY_TRIP_NOTICE, type LegacyTripSummary } from "./legacy-summary.js";

/**
 * Who is asking. Every read and every mutation takes one — D9 made trip access
 * a check rather than a filter, and a defaulted or optional viewer is how that
 * check quietly stops being applied on the one code path nobody re-read.
 *
 * `share` is deliberately not a weaker kind of owner: it can read one trip and
 * nothing else. It cannot list, delete, rename, or re-share.
 */
export type Viewer =
  | { kind: "user"; userId: string }
  | { kind: "anonymous"; ownerToken: string }
  | { kind: "share"; shareToken: string };

/**
 * One row per run that reached a payload-bearing terminal state
 * (run_succeeded or run_infeasible — see server.ts). run_blocked and
 * run_failed never produce a row: there is no Itinerary to store, and the
 * client already has the message via SSE. Progress events stay in-memory
 * only (src/runs/store.ts) — this table is not a durable copy of the run,
 * just the finished trip. See docs/VOYAGEMIND_SPEC.md D7.
 */
export interface TripRecordInput {
  id: string;
  /** Always present: every run comes from a browser, signed in or not. Under
   * D9's dual ownership it decides ownership only while userId is null. */
  ownerToken: string;
  /** Set at creation when the run came from a signed-in browser, and by
   * claimTrips when an anonymous trip is later attached to an account. */
  userId: string | null;
  status: "succeeded" | "infeasible";
  schemaVersion: number;
  request: string;
  brief: TripBrief;
  destinations: Destination[];
  itinerary: Itinerary;
  critique: CritiqueResult;
  /** The Writer's prose, or null — either the run predates the Writer, or its
   * stage failed (swallowed by design, see runWriterStage). Stored rather than
   * regenerated on read: regenerating needs a live model call and is
   * non-deterministic, so a reopened trip would show different prose than the
   * one the traveller read. */
  writerOutput: WriterOutput | null;
  revisionsUsed: number;
}

/**
 * What a read returns — NOT `TripRecordInput & { createdAt }`, and the
 * difference is load-bearing: **`ownerToken` is absent on purpose.**
 *
 * Once a trip can be read by someone holding a share token, echoing the owner
 * token back in the response would hand that reader the exact bearer value
 * `claimTrips` accepts — they could attach someone else's trip to their own
 * account just by opening a link they were legitimately given. The field is
 * removed from the read type rather than stripped in the route handler,
 * because a value that never leaves the store cannot be leaked by a route
 * added later.
 */
export interface TripRecord {
  id: string;
  status: "succeeded" | "infeasible";
  schemaVersion: number;
  request: string;
  /** User-supplied name, or null when never renamed — the UI falls back to
   * `request`, which is what the list showed before titles existed. */
  title: string | null;
  brief: TripBrief;
  destinations: Destination[];
  itinerary: Itinerary;
  critique: CritiqueResult;
  writerOutput: WriterOutput | null;
  revisionsUsed: number;
  createdAt: string;
  /** Lets the client decide whether to render owner-only controls. It is a
   * convenience for the UI and never the thing enforcing anything — every
   * mutation re-checks ownership in the store. */
  isOwner: boolean;
  /** The active share token, or null. Only ever populated for an owner: a
   * share reader already has the token, so returning it to them adds nothing,
   * and returning it to anyone else would be the leak. */
  shareToken: string | null;
}

export type TripReadResult =
  | { ok: true; trip: TripRecord }
  | {
      ok: false;
      readOnly: true;
      notice: string;
      summary: LegacyTripSummary;
      createdAt: string;
      title: string | null;
      isOwner: boolean;
    };

export interface TripSummary {
  id: string;
  request: string;
  title: string | null;
  status: "succeeded" | "infeasible";
  createdAt: string;
  /** Whether a share link is currently active, so the list can show it without
   * exposing the token itself in a list response. */
  shared: boolean;
}

export interface TripStore {
  saveTrip(input: TripRecordInput): Promise<void>;

  /**
   * Null means "you cannot see this", and it is deliberately the same answer
   * as "no such trip". Distinguishing them turns the endpoint into an
   * existence oracle over other people's trip ids.
   */
  getTrip(id: string, viewer: Viewer): Promise<TripReadResult | null>;

  /** Always empty for a `share` viewer: a share token grants one trip, not a
   * listing. */
  listTrips(viewer: Viewer): Promise<TripSummary[]>;

  /** Owner only. False for a missing trip and for a viewer who isn't the
   * owner — a share reader deleting the trip they were shown would otherwise
   * be a one-line mistake away. */
  deleteTrip(id: string, viewer: Viewer): Promise<boolean>;

  /** Owner only. The title is trimmed, and anything that trims to nothing
   * becomes null — clearing a name and never setting one are the same state,
   * so a blank label is not storable. */
  renameTrip(id: string, viewer: Viewer, title: string | null): Promise<boolean>;

  /** Owner only. Pass null to revoke: the previously issued link stops working
   * immediately, which is the entire point of storing the token rather than
   * deriving it from the trip id. */
  setShareToken(id: string, viewer: Viewer, shareToken: string | null): Promise<boolean>;

  /**
   * Attaches every *unclaimed* trip holding `ownerToken` to `userId`, and
   * returns how many moved. Trust-on-presentation, as D9 says plainly: the
   * token is a bearer value with no secret behind it, so this is exactly as
   * strong as that token's confidentiality. `user_id IS NULL` in the predicate
   * is what stops a replayed token from stealing a trip already claimed by
   * someone else.
   */
  claimTrips(ownerToken: string, userId: string): Promise<number>;
}

/** The row shape the access predicates need — the persisted columns that
 * decide ownership, independent of any payload parsing. */
export interface TripOwnershipRow {
  ownerToken: string;
  userId: string | null;
  shareToken: string | null;
}

/**
 * Dual ownership (D9): `user_id` decides when it is set, `owner_token` decides
 * only while it is null. There is deliberately no state where both do — a
 * claimed trip stops belonging to the browser that made it, which is what makes
 * "claim" a transfer rather than a second key.
 *
 * NeonTripStore expresses the same rule in SQL rather than calling this. That
 * duplication is intentional (a WHERE clause is how the database enforces it
 * atomically) and is exactly what store.contract.ts runs against both stores to
 * keep honest.
 */
export function isTripOwner(row: TripOwnershipRow, viewer: Viewer): boolean {
  if (viewer.kind === "user") return row.userId !== null && row.userId === viewer.userId;
  if (viewer.kind === "anonymous") return row.userId === null && row.ownerToken === viewer.ownerToken;
  return false;
}

export function canReadTrip(row: TripOwnershipRow, viewer: Viewer): boolean {
  if (isTripOwner(row, viewer)) return true;
  return viewer.kind === "share" && row.shareToken !== null && row.shareToken === viewer.shareToken;
}

const TripPayloadSchema = z.object({
  brief: TripBriefSchema,
  destinations: z.array(DestinationSchema),
  itinerary: ItinerarySchema,
  critique: CritiqueResultSchema,
  // Nullable, so a row written before writer_output existed still parses at the
  // same TRIP_SCHEMA_VERSION — the reason D8 needs no version bump.
  writerOutput: WriterOutputSchema.nullable(),
});

/**
 * Applies the version-gate decided in D7: a stored row is only ever parsed
 * against the current schemas if its schema_version matches
 * TRIP_SCHEMA_VERSION. On mismatch — or on a same-version parse failure,
 * which means a schema changed without the constant being bumped — this
 * degrades to a read-only summary instead of throwing. Shared by every
 * TripStore implementation so the gate can't drift between them.
 *
 * `isOwner` is passed in rather than computed here: NeonTripStore already
 * decides it in SQL as part of the same query that enforces the access check,
 * and recomputing it in JS would create a second answer to the same question.
 */
export function toTripReadResult(row: {
  id: string;
  status: "succeeded" | "infeasible";
  schemaVersion: number;
  request: string;
  title: string | null;
  brief: unknown;
  destinations: unknown;
  itinerary: unknown;
  critique: unknown;
  writerOutput: unknown;
  revisionsUsed: number;
  createdAt: string;
  isOwner: boolean;
  shareToken: string | null;
}): TripReadResult {
  // Titles survive a version mismatch: the title is a plain column, not part of
  // the versioned agent payload, so a renamed trip keeps its name even when the
  // itinerary itself has degraded to a summary.
  const degraded = (): TripReadResult => ({
    ok: false,
    readOnly: true,
    notice: LEGACY_TRIP_NOTICE,
    summary: extractLegacySummary(row.request, row.brief, row.itinerary),
    createdAt: row.createdAt,
    title: row.title,
    isOwner: row.isOwner,
  });

  if (row.schemaVersion !== TRIP_SCHEMA_VERSION) return degraded();

  const parsed = TripPayloadSchema.safeParse({
    brief: row.brief,
    destinations: row.destinations,
    itinerary: row.itinerary,
    critique: row.critique,
    writerOutput: row.writerOutput ?? null,
  });

  if (!parsed.success) {
    console.error(
      `[trips] row ${row.id} claims schema_version ${row.schemaVersion} (== TRIP_SCHEMA_VERSION) but failed to ` +
        `parse — a schema changed without TRIP_SCHEMA_VERSION being bumped: ${parsed.error.message}`,
    );
    return degraded();
  }

  return {
    ok: true,
    trip: {
      id: row.id,
      status: row.status,
      schemaVersion: row.schemaVersion,
      request: row.request,
      title: row.title,
      brief: parsed.data.brief,
      destinations: parsed.data.destinations,
      itinerary: parsed.data.itinerary,
      critique: parsed.data.critique,
      writerOutput: parsed.data.writerOutput,
      revisionsUsed: row.revisionsUsed,
      createdAt: row.createdAt,
      isOwner: row.isOwner,
      // Owner-only, for the reason on TripRecord.shareToken.
      shareToken: row.isOwner ? row.shareToken : null,
    },
  };
}
