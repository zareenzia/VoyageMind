-- Accounts, server-side sessions, and the access check that D9 makes inseparable
-- from them. See docs/VOYAGEMIND_SPEC.md D9.
--
-- Nothing here touches the JSONB payload columns or schema_version, so
-- TRIP_SCHEMA_VERSION does not move: the version gate covers the shape of the
-- stored agent output, and this migration adds ownership and access columns
-- alongside it. Every existing row still parses exactly as before.

-- Email is stored already-normalised (trimmed, lowercased) by the application,
-- so a plain UNIQUE constraint is enough and no citext extension is needed —
-- Neon supports citext, but depending on an extension for something the app has
-- to normalise anyway buys nothing.
--
-- Unverified on purpose: there is no email provider in Phase 1, so this column
-- is a login identifier and NOT a proof of address. D9 states the consequence —
-- no password reset, no verification — as an accepted limitation rather than a
-- defect to be discovered later.
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,       -- scrypt, "scrypt$N$r$p$salt$hash" (src/auth/passwords.ts)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions, not JWTs (D9): revocation is a DELETE, which is the
-- whole point. The PRIMARY KEY is the SHA-256 of the session token, never the
-- token — a database dump is then a list of dead hashes rather than a set of
-- live sessions. The plaintext token exists only in the httpOnly cookie.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
-- Supports the expiry sweep; the read path filters on expires_at too, so an
-- unswept expired row is never honoured, only unreclaimed.
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- Dual ownership (D9): a trip is owned by user_id when it is non-null, and by
-- owner_token otherwise. owner_token stays NOT NULL because every trip is
-- created by a run that may well be anonymous — signup is not a precondition
-- for planning a trip. Claiming sets user_id; it never clears owner_token, so
-- the claim is auditable and the anonymous browser stops being an owner the
-- moment user_id lands.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users (id) ON DELETE CASCADE;

-- Explicit, opt-in sharing, replacing the implicit readable-by-id model D7 had.
-- NULL means not shared; revoking is setting it back to NULL, which is why this
-- is a nullable column rather than a value minted at trip creation.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS share_token TEXT;

-- A user-supplied name for a saved trip. NULL means "never renamed" — the UI
-- falls back to the original request text, which is what the list showed before
-- this column existed. An empty string is not the same thing and is rejected at
-- the store boundary rather than stored as a blank label.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS title TEXT;

CREATE INDEX IF NOT EXISTS trips_user_id_created_at_idx
  ON trips (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Partial + UNIQUE: share tokens must not collide (the token is the entire
-- credential for a share read), but many trips are unshared and NULL does not
-- conflict with NULL under a plain UNIQUE anyway — the WHERE clause keeps the
-- index to only the rows that are actually shared.
CREATE UNIQUE INDEX IF NOT EXISTS trips_share_token_idx
  ON trips (share_token)
  WHERE share_token IS NOT NULL;
