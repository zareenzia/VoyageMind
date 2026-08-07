import type { IncomingMessage } from "node:http";
import type { AuthService } from "../auth/service.js";
import type { PublicUser } from "../auth/store.js";
import type { Viewer } from "../trips/store.js";
import { readSessionCookie } from "./cookies.js";

export const OWNER_TOKEN_HEADER = "x-owner-token";
export const SHARE_TOKEN_HEADER = "x-share-token";

export interface ResolvedViewer {
  /** The signed-in user, or null. */
  user: PublicUser | null;
  /**
   * The viewer to use for owned access — a user viewer when signed in, an
   * anonymous one when the browser sent its owner token, and null when it sent
   * neither (a caller with no identity at all, which can still read a shared
   * trip and nothing else).
   */
  owned: Viewer | null;
  /** The anonymous token the browser sent, regardless of sign-in state. Needed
   * at signup/login to claim the trips this browser made before it had an
   * account. */
  ownerToken: string | null;
  shareToken: string | null;
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolves who is asking, once per request.
 *
 * The owner token arrives in a header, never a query string. Query strings land
 * in access logs, browser history, and `Referer` on any outbound link, and this
 * token is the bearer value `claimTrips` accepts — logging it would let anyone
 * with log access attach another person's trips to their own account. D9 calls
 * moving it a prerequisite of accounts for exactly that reason.
 *
 * A valid session wins over the owner token: once signed in, the browser's
 * anonymous token stops deciding anything, which is the same rule the store
 * enforces for a claimed trip.
 */
export async function resolveViewer(req: IncomingMessage, auth: AuthService): Promise<ResolvedViewer> {
  const ownerToken = header(req, OWNER_TOKEN_HEADER);
  const shareToken = header(req, SHARE_TOKEN_HEADER);
  const user = await auth.authenticate(readSessionCookie(req));

  const owned: Viewer | null = user
    ? { kind: "user", userId: user.id }
    : ownerToken
      ? { kind: "anonymous", ownerToken }
      : null;

  return { user, owned, ownerToken, shareToken };
}

/**
 * Reads a trip as whoever the caller is, falling back to the share token.
 *
 * Both are attempted because a signed-in user opening someone else's share link
 * is an ordinary case: their own viewer legitimately cannot see the trip, and
 * refusing there would make share links work only for signed-out browsers. The
 * order matters — trying the owned viewer first is what keeps `isOwner` true
 * for an owner who happens to also be holding a share link to their own trip.
 */
export async function readTripAs<T>(
  viewer: ResolvedViewer,
  read: (v: Viewer) => Promise<T | null>,
): Promise<T | null> {
  if (viewer.owned) {
    const owned = await read(viewer.owned);
    if (owned) return owned;
  }
  if (viewer.shareToken) {
    return read({ kind: "share", shareToken: viewer.shareToken });
  }
  return null;
}
