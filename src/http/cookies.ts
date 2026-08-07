import type { IncomingMessage } from "node:http";
import { LIMITS } from "../config.js";

export const SESSION_COOKIE = "vm_session";

/**
 * Parses a Cookie header. Tolerant on purpose — a browser sends whatever other
 * cookies exist on the origin, and one malformed pair must not cost us the
 * session cookie sitting next to it.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // A value that isn't valid percent-encoding is still a value; better to
      // pass it through unchanged than to drop the cookie entirely.
      out[name] = value;
    }
  }
  return out;
}

export function readSessionCookie(req: IncomingMessage): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
}

/**
 * `Secure` is set only when the request actually arrived over TLS: hard-coding
 * it would make login silently fail on `http://localhost`, where the browser
 * accepts the Set-Cookie header and then never sends the cookie back — a
 * failure that looks like "login doesn't work" with nothing in the logs.
 *
 * `x-forwarded-proto` is consulted because a deployment behind a TLS-
 * terminating proxy sees a plain HTTP socket. A forged header can only cause
 * `Secure` to be set on a connection that isn't secure, which fails closed
 * (the browser stops sending the cookie); it cannot cause it to be omitted on
 * one that is.
 */
function isSecureRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return "encrypted" in req.socket && Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

/**
 * `HttpOnly` is the whole reason D9 rejected a token in localStorage: script on
 * the page cannot read this value, so an XSS bug cannot exfiltrate the session.
 *
 * `SameSite=Lax` is the CSRF control. It withholds the cookie from cross-site
 * POST/PATCH/DELETE, which covers every state-changing route here — none of
 * them is a GET, and that is a property to preserve rather than a coincidence.
 */
export function sessionCookieHeader(req: IncomingMessage, token: string): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${LIMITS.sessionLifetimeDays * 86_400}`,
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  return attributes.join("; ");
}

/** Max-Age=0 with the same Path/SameSite — a cookie is only replaced by one
 * whose attributes match, so these have to mirror sessionCookieHeader. */
export function clearSessionCookieHeader(req: IncomingMessage): string {
  const attributes = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest(req)) attributes.push("Secure");
  return attributes.join("; ");
}
