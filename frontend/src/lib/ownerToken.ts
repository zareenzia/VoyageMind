const STORAGE_KEY = "voyagemind_owner_token";

/**
 * Anonymous, per-browser identity for "my trips" — never an access check
 * (any trip is still readable by id). Generated once and kept in
 * localStorage; there is no accounts system to attach it to yet. See
 * docs/VOYAGEMIND_SPEC.md D7.
 */
export function getOwnerToken(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const token = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, token);
  return token;
}
