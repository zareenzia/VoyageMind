import { z } from "zod";

/**
 * Shown verbatim to the user whenever a stored trip's schema_version doesn't
 * match TRIP_SCHEMA_VERSION. Never throw and never attempt the full itinerary
 * view on unvalidated data — see CLAUDE.md rule 9.
 */
export const LEGACY_TRIP_NOTICE = "Saved under an older format — full detail unavailable.";

export interface LegacyTripSummary {
  request: string;
  destinationNames: string[];
  startDate: string | null;
  endDate: string | null;
  dayCount: number | null;
}

/**
 * Best-effort projection of a JSONB blob whose shape is no longer trusted to
 * match the current schemas. Every field degrades independently to null/[]
 * rather than the whole extraction failing — same "unknown is null, never a
 * guess" discipline as the rest of the pipeline, just applied to a stored row
 * instead of a model call. This targets the field names TripBriefSchema and
 * ItinerarySchema use as of TRIP_SCHEMA_VERSION at the time this was written;
 * a future schema change that renames these fields again should extend this
 * projection rather than replace it, so still-older rows keep degrading
 * gracefully instead of losing summary data outright.
 */
const LegacyProjectionSchema = z.object({
  brief: z
    .object({
      destinations: z.array(z.string()).optional(),
      start_date: z.string().nullable().optional(),
      end_date: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
  itinerary: z
    .object({
      days: z.array(z.unknown()).optional(),
    })
    .partial()
    .optional(),
});

export function extractLegacySummary(request: string, rawBrief: unknown, rawItinerary: unknown): LegacyTripSummary {
  const parsed = LegacyProjectionSchema.safeParse({ brief: rawBrief, itinerary: rawItinerary });
  if (!parsed.success) {
    return { request, destinationNames: [], startDate: null, endDate: null, dayCount: null };
  }

  const { brief, itinerary } = parsed.data;
  return {
    request,
    destinationNames: brief?.destinations ?? [],
    startDate: brief?.start_date ?? null,
    endDate: brief?.end_date ?? null,
    dayCount: itinerary?.days?.length ?? null,
  };
}
