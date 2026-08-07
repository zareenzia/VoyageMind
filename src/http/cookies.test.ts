import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clearSessionCookieHeader, parseCookies, readSessionCookie, sessionCookieHeader } from "./cookies.js";

function req(headers: Record<string, string | string[]> = {}, encrypted = false): IncomingMessage {
  return { headers, socket: { encrypted } } as unknown as IncomingMessage;
}

describe("parseCookies", () => {
  it("parses a single pair and several", () => {
    expect(parseCookies("a=1")).toEqual({ a: "1" });
    expect(parseCookies("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("returns an empty object for a missing or empty header", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("percent-decodes values", () => {
    expect(parseCookies("t=a%20b%3Dc")).toEqual({ t: "a b=c" });
  });

  /** A browser sends every cookie on the origin. One malformed pair from some
   * other script must not cost us the session cookie sitting beside it. */
  it("keeps the good pairs when a neighbour is malformed", () => {
    expect(parseCookies("broken; vm_session=abc; =novalue; alsobroken")).toEqual({ vm_session: "abc" });
  });

  it("passes through a value that isn't valid percent-encoding instead of dropping it", () => {
    expect(parseCookies("vm_session=100%")).toEqual({ vm_session: "100%" });
  });

  it("keeps values containing '=' intact", () => {
    expect(parseCookies("vm_session=abc=def==")).toEqual({ vm_session: "abc=def==" });
  });

  it("reads the session cookie off a request", () => {
    expect(readSessionCookie(req({ cookie: "vm_session=tok" }))).toBe("tok");
    expect(readSessionCookie(req())).toBeNull();
  });
});

describe("sessionCookieHeader", () => {
  /** HttpOnly is the reason D9 rejected a token in localStorage: script on the
   * page cannot read it, so an XSS bug cannot exfiltrate the session. */
  it("is HttpOnly, path-wide, and SameSite=Lax", () => {
    const header = sessionCookieHeader(req(), "tok");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
  });

  /**
   * Hard-coding Secure would make sign-in fail silently on http://localhost —
   * the browser accepts the Set-Cookie and then never sends the cookie back,
   * which looks like "login doesn't work" with nothing in the logs.
   */
  it("omits Secure on a plain HTTP request and sets it on a TLS one", () => {
    expect(sessionCookieHeader(req(), "tok")).not.toContain("Secure");
    expect(sessionCookieHeader(req({}, true), "tok")).toContain("Secure");
    expect(sessionCookieHeader(req({ "x-forwarded-proto": "https" }), "tok")).toContain("Secure");
  });

  it("reads only the first entry of a comma-joined x-forwarded-proto chain", () => {
    expect(sessionCookieHeader(req({ "x-forwarded-proto": "https, http" }), "tok")).toContain("Secure");
    expect(sessionCookieHeader(req({ "x-forwarded-proto": "http, https" }), "tok")).not.toContain("Secure");
  });

  it("url-encodes the token", () => {
    expect(sessionCookieHeader(req(), "a b")).toContain("vm_session=a%20b");
  });

  /** A cookie is only replaced by one whose attributes match, so the clearing
   * header has to mirror the setting one or sign-out leaves the cookie live. */
  it("clears with matching attributes and a zero Max-Age", () => {
    const header = clearSessionCookieHeader(req());
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
  });
});
