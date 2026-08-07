import { Pool } from "pg";
import {
  toTripReadResult,
  type TripReadResult,
  type TripRecordInput,
  type TripStore,
  type TripSummary,
  type Viewer,
} from "./store.js";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * A Viewer flattened into the three nullable values the SQL predicates bind.
 * Passing SQL NULL for the irrelevant ones is what disables the branches that
 * don't apply: `user_id = NULL` is NULL, never true, so an anonymous viewer
 * cannot match the user-ownership arm no matter what is in the column.
 */
function viewerParams(viewer: Viewer): { userId: string | null; ownerToken: string | null; shareToken: string | null } {
  return {
    userId: viewer.kind === "user" ? viewer.userId : null,
    ownerToken: viewer.kind === "anonymous" ? viewer.ownerToken : null,
    shareToken: viewer.kind === "share" ? viewer.shareToken : null,
  };
}

/**
 * Dual ownership (D9) as a SQL predicate — the same rule `isTripOwner` states
 * in JS, expressed here so the database enforces it inside the same statement
 * as the UPDATE/DELETE rather than in a read-then-write the store would have
 * to make atomic itself. store.contract.ts runs against both implementations
 * precisely because this rule now exists in two languages.
 *
 * COALESCE(..., false) matters: with a NULL parameter the comparison is NULL,
 * not false, and a NULL would surface as `is_owner: null` in a SELECT list
 * even though it correctly filters a row out in a WHERE clause.
 *
 * The interpolated values are placeholder *numbers* this module controls, never
 * caller data — every actual value is still bound.
 */
function ownerSql(userIdParam: number, ownerTokenParam: number): string {
  return (
    `COALESCE((user_id IS NOT NULL AND user_id = $${userIdParam}) ` +
    `OR (user_id IS NULL AND owner_token = $${ownerTokenParam}), false)`
  );
}

function readSql(userIdParam: number, ownerTokenParam: number, shareTokenParam: number): string {
  return (
    `(${ownerSql(userIdParam, ownerTokenParam)} ` +
    `OR COALESCE(share_token IS NOT NULL AND share_token = $${shareTokenParam}, false))`
  );
}

/**
 * Talks to Postgres via the pooled connection string (DATABASE_URL — PgBouncer
 * in transaction-pooling mode). Every query here uses pg's plain unnamed form,
 * `pool.query(text, values)` — never `pool.query({ name, text, values })`.
 * Named/prepared statements aren't reliably supported across PgBouncer
 * transaction pooling and would show up as an intermittent production error,
 * not a local one, so keep new queries in this file to the unnamed form.
 *
 * JSONB parameters are always JSON.stringify()'d explicitly. pg auto-serializes
 * plain objects, but a raw JS array (e.g. `destinations`) gets converted to a
 * Postgres ARRAY literal instead of a JSON array if passed unstringified —
 * stringifying every JSONB parameter avoids depending on which of those two
 * behaviors applies to which shape.
 */
export class NeonTripStore implements TripStore {
  private readonly pool: Pool;

  /**
   * Deliberately does NOT throw when DATABASE_URL is unset: this store is
   * constructed once at server.ts module scope, and a synchronous throw
   * there would take down the entire process — including the run/SSE
   * pipeline, which has nothing to do with trips — over a missing env var
   * that only matters for persistence. Instead, a missing/bad connection
   * string surfaces as a failed query the first time a trips operation
   * actually runs, which every call site here already catches and logs
   * (see persistTrip's try/catch in server.ts and the /trips route
   * handlers) — a dev box with no Neon configured just never gets a "my
   * trips" entry, exactly the degradation D7 describes.
   */
  constructor(connectionString: string | undefined = process.env.DATABASE_URL) {
    this.pool = new Pool({ connectionString });
  }

  async saveTrip(input: TripRecordInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO trips
         (id, owner_token, user_id, status, schema_version, request, brief, destinations, itinerary, critique,
          writer_output, revisions_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.id,
        input.ownerToken,
        input.userId,
        input.status,
        input.schemaVersion,
        input.request,
        JSON.stringify(input.brief),
        JSON.stringify(input.destinations),
        JSON.stringify(input.itinerary),
        JSON.stringify(input.critique),
        // null, not JSON.stringify(null) — the latter stores the JSONB scalar
        // 'null', which is not the same as a SQL NULL and would defeat
        // `writer_output IS NULL` checks.
        input.writerOutput === null ? null : JSON.stringify(input.writerOutput),
        input.revisionsUsed,
      ],
    );
  }

  async getTrip(id: string, viewer: Viewer): Promise<TripReadResult | null> {
    const v = viewerParams(viewer);
    // The access check is the WHERE clause, so an unreadable trip returns no
    // row and is indistinguishable from one that does not exist.
    const result = await this.pool.query(
      `SELECT id, status, schema_version, request, title, brief, destinations, itinerary, critique,
              writer_output, revisions_used, created_at, share_token,
              ${ownerSql(2, 3)} AS is_owner
       FROM trips
       WHERE id = $1 AND ${readSql(2, 3, 4)}`,
      [id, v.userId, v.ownerToken, v.shareToken],
    );
    const row = result.rows[0];
    if (!row) return null;
    return toTripReadResult({
      id: row.id,
      status: row.status,
      schemaVersion: row.schema_version,
      request: row.request,
      title: row.title,
      brief: row.brief,
      destinations: row.destinations,
      itinerary: row.itinerary,
      critique: row.critique,
      writerOutput: row.writer_output,
      revisionsUsed: row.revisions_used,
      createdAt: toIso(row.created_at),
      isOwner: row.is_owner === true,
      shareToken: row.share_token,
    });
  }

  async listTrips(viewer: Viewer): Promise<TripSummary[]> {
    // A share token grants one trip, not a listing — and short-circuiting here
    // means the query is never issued with three NULL parameters, which would
    // match nothing but says something different about intent.
    if (viewer.kind === "share") return [];
    const v = viewerParams(viewer);
    const result = await this.pool.query(
      `SELECT id, request, title, status, created_at, (share_token IS NOT NULL) AS shared
       FROM trips
       WHERE ${ownerSql(1, 2)}
       ORDER BY created_at DESC`,
      [v.userId, v.ownerToken],
    );
    return result.rows.map((row) => ({
      id: row.id,
      request: row.request,
      title: row.title,
      status: row.status,
      createdAt: toIso(row.created_at),
      shared: row.shared === true,
    }));
  }

  async deleteTrip(id: string, viewer: Viewer): Promise<boolean> {
    const v = viewerParams(viewer);
    const result = await this.pool.query(`DELETE FROM trips WHERE id = $1 AND ${ownerSql(2, 3)}`, [
      id,
      v.userId,
      v.ownerToken,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async renameTrip(id: string, viewer: Viewer, title: string | null): Promise<boolean> {
    const v = viewerParams(viewer);
    const trimmed = title === null ? null : title.trim();
    const result = await this.pool.query(
      `UPDATE trips SET title = $4 WHERE id = $1 AND ${ownerSql(2, 3)}`,
      // Blank collapses to NULL: clearing a name and never setting one are the
      // same state, so "   " is not a storable label.
      [id, v.userId, v.ownerToken, trimmed === null || trimmed.length === 0 ? null : trimmed],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setShareToken(id: string, viewer: Viewer, shareToken: string | null): Promise<boolean> {
    const v = viewerParams(viewer);
    const result = await this.pool.query(
      `UPDATE trips SET share_token = $4 WHERE id = $1 AND ${ownerSql(2, 3)}`,
      [id, v.userId, v.ownerToken, shareToken],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimTrips(ownerToken: string, userId: string): Promise<number> {
    // `user_id IS NULL` is the whole guard: a replayed owner token cannot take
    // a trip that already belongs to an account.
    const result = await this.pool.query(
      `UPDATE trips SET user_id = $2 WHERE owner_token = $1 AND user_id IS NULL`,
      [ownerToken, userId],
    );
    return result.rowCount ?? 0;
  }

  /** Not part of TripStore — only for scripts (migrate/check-neon) that need
   * the process to exit instead of holding the pool open. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
