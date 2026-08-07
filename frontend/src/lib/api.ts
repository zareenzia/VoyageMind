import { getOwnerToken } from "./ownerToken.ts";
import { getShareTokenFromUrl } from "./shareToken.ts";

/**
 * The single place every API call goes through, so no request can forget to
 * identify itself. Three things are attached here rather than at each call
 * site:
 *
 * - `X-Owner-Token`, always. It used to travel in the query string, which put
 *   it in access logs, browser history, and `Referer` — unacceptable once it
 *   became the bearer value that claims trips into an account (spec D9).
 * - `X-Share-Token`, when the current URL carries one, so opening a shared link
 *   works without every hook knowing about sharing.
 * - `credentials: "same-origin"`, so the httpOnly session cookie is sent. It is
 *   the default in browsers, and stated explicitly because the whole auth model
 *   silently degrades to signed-out if it is ever not.
 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Owner-Token", getOwnerToken());

  const shareToken = getShareTokenFromUrl();
  if (shareToken) headers.set("X-Share-Token", shareToken);

  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  return fetch(path, { ...init, headers, credentials: "same-origin" });
}

export class ApiError extends Error {
  // Declared and assigned rather than a constructor parameter property: the
  // frontend tsconfig sets `erasableSyntaxOnly`, which rules that shorthand out.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Prefers the server's own `error` string over a status-code message: those
 * strings are written to be read by a person ("Email or password is
 * incorrect."), and replacing them with "Request failed: 401" throws away the
 * only useful part of the response.
 */
async function toError(res: Response, fallback: string): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) return new ApiError(body.error, res.status);
  } catch {
    // Non-JSON body (a proxy error page, say) — fall through.
  }
  return new ApiError(`${fallback} (${res.status})`, res.status);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await request(path);
  if (!res.ok) throw await toError(res, "Request failed");
  return (await res.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await toError(res, "Request failed");
  return (await res.json()) as T;
}

/** For the two endpoints where a 404 is an ordinary answer rather than a
 * failure — reading a trip that may not exist or may not be yours, which the
 * server deliberately does not distinguish. */
export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  const res = await request(path);
  if (res.status === 404) return null;
  if (!res.ok) throw await toError(res, "Request failed");
  return (await res.json()) as T;
}
