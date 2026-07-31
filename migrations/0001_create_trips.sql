-- One row per run that reached a payload-bearing terminal state
-- (run_succeeded or run_infeasible). Progress events stay in-memory only —
-- see src/runs/store.ts and docs/VOYAGEMIND_SPEC.md D7.
CREATE TABLE IF NOT EXISTS trips (
  id              UUID PRIMARY KEY,           -- same id as the run_id / SSE stream
  owner_token     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('succeeded', 'infeasible')),
  schema_version  INTEGER NOT NULL,
  request         TEXT NOT NULL,               -- original free-text ask, for list labels
  brief           JSONB NOT NULL,
  destinations    JSONB NOT NULL,
  itinerary       JSONB NOT NULL,
  critique        JSONB NOT NULL,
  revisions_used  INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trips_owner_token_created_at_idx
  ON trips (owner_token, created_at DESC);
