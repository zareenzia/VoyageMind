const STORAGE_KEY = "voyagemind_owner_token";

/**
 * Anonymous, per-browser identity for trips made while signed out. Generated
 * once and kept in localStorage.
 *
 * Since spec D9 this really does gate access — an anonymous trip is readable
 * only by the browser holding this token, not by anyone with the id — and it is
 * the bearer value that attaches those trips to an account on sign-in. That is
 * why it travels in the `X-Owner-Token` header and never in a query string
 * (see lib/api.ts), and why nothing renders it on screen.
 *
 * Once signed in it stops deciding anything: a claimed trip belongs to the user
 * id, and the server ignores this token for it.
 */
export function getOwnerToken(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const token = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, token);
  return token;
}
