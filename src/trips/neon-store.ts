import { Pool } from "pg";
import { toTripReadResult, type TripReadResult, type TripRecordInput, type TripStore, type TripSummary } from "./store.js";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
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
         (id, owner_token, status, schema_version, request, brief, destinations, itinerary, critique, revisions_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.ownerToken,
        input.status,
        input.schemaVersion,
        input.request,
        JSON.stringify(input.brief),
        JSON.stringify(input.destinations),
        JSON.stringify(input.itinerary),
        JSON.stringify(input.critique),
        input.revisionsUsed,
      ],
    );
  }

  async getTrip(id: string): Promise<TripReadResult | null> {
    const result = await this.pool.query(
      `SELECT id, owner_token, status, schema_version, request, brief, destinations, itinerary, critique,
              revisions_used, created_at
       FROM trips WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return toTripReadResult({
      id: row.id,
      ownerToken: row.owner_token,
      status: row.status,
      schemaVersion: row.schema_version,
      request: row.request,
      brief: row.brief,
      destinations: row.destinations,
      itinerary: row.itinerary,
      critique: row.critique,
      revisionsUsed: row.revisions_used,
      createdAt: toIso(row.created_at),
    });
  }

  async listTripsForOwner(ownerToken: string): Promise<TripSummary[]> {
    const result = await this.pool.query(
      `SELECT id, request, status, created_at FROM trips WHERE owner_token = $1 ORDER BY created_at DESC`,
      [ownerToken],
    );
    return result.rows.map((row) => ({
      id: row.id,
      request: row.request,
      status: row.status,
      createdAt: toIso(row.created_at),
    }));
  }

  async deleteTrip(id: string, ownerToken: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM trips WHERE id = $1 AND owner_token = $2`, [id, ownerToken]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Not part of TripStore — only for scripts (migrate/check-neon) that need
   * the process to exit instead of holding the pool open. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
