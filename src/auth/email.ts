/**
 * Emails are normalised once, here, before they ever reach the store — which is
 * what lets `users.email` be a plain UNIQUE column instead of citext. Both
 * signup and login go through this, or "Alice@x.com" and "alice@x.com" become
 * two accounts.
 *
 * Deliberately NOT normalised: gmail's dots-and-plus-addressing equivalence.
 * That rule is provider-specific, and applying it universally silently merges
 * two genuinely different addresses on providers that treat them as distinct.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A shape check, not a validity check — the only way to know an address exists
 * is to send mail to it, and Phase 1 has no email provider (D9). This rejects
 * obvious nonsense so a typo fails at signup rather than becoming an
 * unrecoverable account, and nothing more is claimed for it.
 */
export function isPlausibleEmail(value: string): boolean {
  if (value.length < 3 || value.length > 254) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  if (domain.length === 0 || !domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  return !/\s/.test(value);
}
