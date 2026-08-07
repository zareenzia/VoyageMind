import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { LIMITS } from "../config.js";
import { newShareToken } from "../trips/share-tokens.js";
import type { TripStore } from "../trips/store.js";
import { readTripAs, resolveViewer } from "./viewer.js";

const TRIP_PATH = /^\/trips\/([0-9a-fA-F-]{36})$/;
const TRIP_SHARE_PATH = /^\/trips\/([0-9a-fA-F-]{36})\/share$/;

const RenameBodySchema = z.object({
  // Nullable rather than optional: clearing a title is an explicit `null`, not
  // an absent field, so a client bug that drops the key is a 400 and not a
  // silent rename to nothing.
  title: z.string().max(LIMITS.maxTripTitleLength).nullable(),
});

export interface TripRouteDeps {
  auth: AuthService;
  tripStore: TripStore;
  writeJson: (res: ServerResponse, status: number, body: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<string>;
}

/**
 * `false` is returned for "not found" and for "you may not see this" alike —
 * the store already collapses those two cases, and this message must not
 * un-collapse them. A 404 that says "this trip exists but isn't yours" is an
 * existence oracle over other people's trip ids.
 */
const NOT_FOUND = { error: "Unknown trip" };

/** Returns true if the request was a trips route and has been handled. */
export async function handleTripRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: TripRouteDeps,
): Promise<boolean> {
  const { auth, tripStore, writeJson, readBody } = deps;

  if (req.method === "GET" && pathname === "/trips") {
    try {
      const viewer = await resolveViewer(req, auth);
      // No identity at all means no list — not an error. A share token grants
      // one trip and never a listing, so it deliberately doesn't count here.
      if (!viewer.owned) {
        writeJson(res, 200, { trips: [] });
        return true;
      }
      writeJson(res, 200, { trips: await tripStore.listTrips(viewer.owned) });
    } catch (error) {
      console.error(`[trips] failed to list trips: ${error instanceof Error ? error.message : String(error)}`);
      writeJson(res, 502, { error: "Could not load trips right now." });
    }
    return true;
  }

  const shareMatch = pathname.match(TRIP_SHARE_PATH);
  if (shareMatch) {
    const tripId = shareMatch[1]!;

    // Creating a link, or rotating an existing one — rotation is why this is
    // POST and not PUT: it mints a new token and the previous link stops
    // working, which is a state change with a different result each time.
    if (req.method === "POST") {
      try {
        const viewer = await resolveViewer(req, auth);
        if (!viewer.owned) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        const shareToken = newShareToken();
        const updated = await tripStore.setShareToken(tripId, viewer.owned, shareToken);
        if (!updated) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        writeJson(res, 200, { shareToken });
      } catch (error) {
        console.error(`[trips] failed to share trip ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not create a share link right now." });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        const viewer = await resolveViewer(req, auth);
        if (!viewer.owned) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        const updated = await tripStore.setShareToken(tripId, viewer.owned, null);
        if (!updated) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        writeJson(res, 200, { shareToken: null });
      } catch (error) {
        console.error(`[trips] failed to revoke sharing on ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not revoke the share link right now." });
      }
      return true;
    }
  }

  const tripMatch = pathname.match(TRIP_PATH);
  if (tripMatch) {
    const tripId = tripMatch[1]!;

    if (req.method === "GET") {
      try {
        const viewer = await resolveViewer(req, auth);
        const result = await readTripAs(viewer, (v) => tripStore.getTrip(tripId, v));
        if (!result) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        writeJson(res, 200, result);
      } catch (error) {
        console.error(`[trips] failed to read trip ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not load this trip right now." });
      }
      return true;
    }

    if (req.method === "PATCH") {
      let body: z.infer<typeof RenameBodySchema>;
      try {
        body = RenameBodySchema.parse(JSON.parse(await readBody(req)));
      } catch {
        writeJson(res, 400, {
          error: `A title of at most ${LIMITS.maxTripTitleLength} characters, or null to clear it, is required.`,
        });
        return true;
      }

      try {
        const viewer = await resolveViewer(req, auth);
        if (!viewer.owned) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        // Owner only: readTripAs is deliberately NOT used here, so holding a
        // share link never becomes a way to rename someone else's trip.
        const renamed = await tripStore.renameTrip(tripId, viewer.owned, body.title);
        if (!renamed) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        writeJson(res, 200, { ok: true });
      } catch (error) {
        console.error(`[trips] failed to rename trip ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not rename this trip right now." });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        const viewer = await resolveViewer(req, auth);
        if (!viewer.owned) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        const deleted = await tripStore.deleteTrip(tripId, viewer.owned);
        if (!deleted) {
          writeJson(res, 404, NOT_FOUND);
          return true;
        }
        writeJson(res, 200, { deleted: true });
      } catch (error) {
        console.error(`[trips] failed to delete trip ${tripId}: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 502, { error: "Could not delete this trip right now." });
      }
      return true;
    }
  }

  return false;
}
