import { z } from "zod";
import {
  CritiqueResultSchema,
  DestinationSchema,
  ItinerarySchema,
  TripBriefSchema,
  TRIP_SCHEMA_VERSION,
  type CritiqueResult,
  type Destination,
  type Itinerary,
  type TripBrief,
} from "../schemas/index.js";
import { extractLegacySummary, LEGACY_TRIP_NOTICE, type LegacyTripSummary } from "./legacy-summary.js";

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
  ownerToken: string;
  status: "succeeded" | "infeasible";
  schemaVersion: number;
  request: string;
  brief: TripBrief;
  destinations: Destination[];
  itinerary: Itinerary;
  critique: CritiqueResult;
  revisionsUsed: number;
}

export interface TripRecord extends TripRecordInput {
  createdAt: string;
}

export type TripReadResult =
  | { ok: true; trip: TripRecord }
  | { ok: false; readOnly: true; notice: string; summary: LegacyTripSummary; createdAt: string };

export interface TripSummary {
  id: string;
  request: string;
  status: "succeeded" | "infeasible";
  createdAt: string;
}

export interface TripStore {
  saveTrip(input: TripRecordInput): Promise<void>;
  getTrip(id: string): Promise<TripReadResult | null>;
  listTripsForOwner(ownerToken: string): Promise<TripSummary[]>;
  /** Returns false if the id doesn't exist or ownerToken doesn't match — the
   * token is the only meaningful guard here (there's no auth), so a mismatch
   * fails the same way as a missing row rather than confirming existence. */
  deleteTrip(id: string, ownerToken: string): Promise<boolean>;
}

const TripPayloadSchema = z.object({
  brief: TripBriefSchema,
  destinations: z.array(DestinationSchema),
  itinerary: ItinerarySchema,
  critique: CritiqueResultSchema,
});

/**
 * Applies the version-gate decided in D7: a stored row is only ever parsed
 * against the current schemas if its schema_version matches
 * TRIP_SCHEMA_VERSION. On mismatch — or on a same-version parse failure,
 * which means a schema changed without the constant being bumped — this
 * degrades to a read-only summary instead of throwing. Shared by every
 * TripStore implementation so the gate can't drift between them.
 */
export function toTripReadResult(row: {
  id: string;
  ownerToken: string;
  status: "succeeded" | "infeasible";
  schemaVersion: number;
  request: string;
  brief: unknown;
  destinations: unknown;
  itinerary: unknown;
  critique: unknown;
  revisionsUsed: number;
  createdAt: string;
}): TripReadResult {
  if (row.schemaVersion !== TRIP_SCHEMA_VERSION) {
    return {
      ok: false,
      readOnly: true,
      notice: LEGACY_TRIP_NOTICE,
      summary: extractLegacySummary(row.request, row.brief, row.itinerary),
      createdAt: row.createdAt,
    };
  }

  const parsed = TripPayloadSchema.safeParse({
    brief: row.brief,
    destinations: row.destinations,
    itinerary: row.itinerary,
    critique: row.critique,
  });

  if (!parsed.success) {
    console.error(
      `[trips] row ${row.id} claims schema_version ${row.schemaVersion} (== TRIP_SCHEMA_VERSION) but failed to ` +
        `parse — a schema changed without TRIP_SCHEMA_VERSION being bumped: ${parsed.error.message}`,
    );
    return {
      ok: false,
      readOnly: true,
      notice: LEGACY_TRIP_NOTICE,
      summary: extractLegacySummary(row.request, row.brief, row.itinerary),
      createdAt: row.createdAt,
    };
  }

  return {
    ok: true,
    trip: {
      id: row.id,
      ownerToken: row.ownerToken,
      status: row.status,
      schemaVersion: row.schemaVersion,
      request: row.request,
      brief: parsed.data.brief,
      destinations: parsed.data.destinations,
      itinerary: parsed.data.itinerary,
      critique: parsed.data.critique,
      revisionsUsed: row.revisionsUsed,
      createdAt: row.createdAt,
    },
  };
}
