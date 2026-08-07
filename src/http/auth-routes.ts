import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import type { TripStore } from "../trips/store.js";
import { clearSessionCookieHeader, readSessionCookie, sessionCookieHeader } from "./cookies.js";
import { resolveViewer } from "./viewer.js";

const CredentialsSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/**
 * One message for every credential failure, matching AuthService's single
 * `invalid_credentials` reason. Splitting it into "no such account" and "wrong
 * password" here would undo the whole point of the service returning one
 * reason (D9).
 */
const CREDENTIALS_MESSAGE = "Email or password is incorrect.";

export interface AuthRouteDeps {
  auth: AuthService;
  tripStore: TripStore;
  writeJson: (res: ServerResponse, status: number, body: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<string>;
}

/**
 * Attaches the trips this browser made before it had an account. Failure is
 * swallowed and logged, never surfaced: the user has just signed up or signed
 * in successfully, and turning that into an error because a follow-up UPDATE
 * failed would be the same mistake D7 warned about for trip persistence — a
 * storage problem presented as a failure of the thing that actually worked.
 * The visible consequence is that some older trips stay in the anonymous list.
 */
async function claimAnonymousTrips(
  tripStore: TripStore,
  ownerToken: string | null,
  userId: string,
): Promise<number> {
  if (!ownerToken) return 0;
  try {
    return await tripStore.claimTrips(ownerToken, userId);
  } catch (error) {
    console.error(
      `[auth] failed to claim trips for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

/** Returns true if the request was an auth route and has been handled. */
export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: AuthRouteDeps,
): Promise<boolean> {
  const { auth, tripStore, writeJson, readBody } = deps;

  if (req.method === "POST" && pathname === "/auth/signup") {
    let credentials: z.infer<typeof CredentialsSchema>;
    try {
      credentials = CredentialsSchema.parse(JSON.parse(await readBody(req)));
    } catch {
      writeJson(res, 400, { error: "An email and password are required." });
      return true;
    }

    try {
      const { ownerToken } = await resolveViewer(req, auth);
      const result = await auth.signup(credentials.email, credentials.password);

      if (!result.ok) {
        const status = result.reason === "email_taken" ? 409 : 400;
        writeJson(res, status, { error: signupMessage(result.reason), reason: result.reason });
        return true;
      }

      const claimed = await claimAnonymousTrips(tripStore, ownerToken, result.user.id);
      res.setHeader("set-cookie", sessionCookieHeader(req, result.session.token));
      writeJson(res, 201, { user: result.user, claimedTrips: claimed });
    } catch (error) {
      console.error(`[auth] signup failed: ${error instanceof Error ? error.message : String(error)}`);
      writeJson(res, 502, { error: "Could not create an account right now." });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/login") {
    let credentials: z.infer<typeof CredentialsSchema>;
    try {
      credentials = CredentialsSchema.parse(JSON.parse(await readBody(req)));
    } catch {
      writeJson(res, 400, { error: "An email and password are required." });
      return true;
    }

    try {
      const { ownerToken } = await resolveViewer(req, auth);
      const result = await auth.login(credentials.email, credentials.password);

      if (!result.ok) {
        if (result.reason === "too_many_attempts") {
          writeJson(res, 429, {
            error: "Too many sign-in attempts for this address. Try again shortly.",
            reason: result.reason,
          });
        } else {
          writeJson(res, 401, { error: CREDENTIALS_MESSAGE, reason: result.reason });
        }
        return true;
      }

      const claimed = await claimAnonymousTrips(tripStore, ownerToken, result.user.id);
      res.setHeader("set-cookie", sessionCookieHeader(req, result.session.token));
      writeJson(res, 200, { user: result.user, claimedTrips: claimed });
    } catch (error) {
      console.error(`[auth] login failed: ${error instanceof Error ? error.message : String(error)}`);
      writeJson(res, 502, { error: "Could not sign in right now." });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/logout") {
    // The cookie is cleared even if the DELETE fails: leaving a browser holding
    // a cookie it believes is signed out is the worse of the two outcomes, and
    // the session still expires on its own.
    res.setHeader("set-cookie", clearSessionCookieHeader(req));
    try {
      await auth.logout(readSessionCookie(req));
    } catch (error) {
      console.error(`[auth] logout failed to delete the session row: ${error instanceof Error ? error.message : String(error)}`);
    }
    writeJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/auth/logout-everywhere") {
    try {
      const { user } = await resolveViewer(req, auth);
      if (!user) {
        writeJson(res, 401, { error: "Not signed in." });
        return true;
      }
      const revoked = await auth.logoutEverywhere(user.id);
      res.setHeader("set-cookie", clearSessionCookieHeader(req));
      writeJson(res, 200, { ok: true, revoked });
    } catch (error) {
      console.error(`[auth] logout-everywhere failed: ${error instanceof Error ? error.message : String(error)}`);
      writeJson(res, 502, { error: "Could not sign out everywhere right now." });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/auth/me") {
    try {
      const { user } = await resolveViewer(req, auth);
      // 200 with a null user, not 401: "am I signed in?" is a question with two
      // ordinary answers, and the frontend asks it on every page load.
      writeJson(res, 200, { user });
    } catch (error) {
      console.error(`[auth] /auth/me failed: ${error instanceof Error ? error.message : String(error)}`);
      writeJson(res, 502, { error: "Could not check the session right now." });
    }
    return true;
  }

  return false;
}

function signupMessage(reason: "invalid_email" | "weak_password" | "email_taken"): string {
  if (reason === "invalid_email") return "That doesn't look like an email address.";
  if (reason === "email_taken") return "An account with that email already exists.";
  return "Password is too short.";
}
