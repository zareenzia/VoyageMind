import { Pool } from "pg";
import type { AuthStore, CreateUserResult, SessionRecord, UserRecord } from "./store.js";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Same conventions as NeonTripStore, for the same reasons: the pooled
 * connection string, and only pg's unnamed `pool.query(text, values)` form —
 * named/prepared statements are not reliable across PgBouncer transaction
 * pooling and would fail in production but not locally.
 *
 * A separate Pool from NeonTripStore's rather than a shared one. Both are
 * lazy (pg opens no connection until a query runs), so an idle server still
 * holds nothing open and D6's scale-to-zero is unaffected; sharing would mean
 * one store's close() silently killing the other's, which the two contract
 * suites in `npm run test:neon` would hit immediately.
 */
export class NeonAuthStore implements AuthStore {
  private readonly pool: Pool;

  /** Like NeonTripStore, does not throw on a missing DATABASE_URL: this is
   * constructed at module scope in server.ts, and a synchronous throw there
   * would take down the run/SSE pipeline over an env var that only matters
   * for accounts. A missing connection string surfaces as a failed query on
   * the first auth request, which the route handlers catch. */
  constructor(connectionString: string | undefined = process.env.DATABASE_URL) {
    this.pool = new Pool({ connectionString });
  }

  async createUser(input: { id: string; email: string; passwordHash: string }): Promise<CreateUserResult> {
    // ON CONFLICT DO NOTHING, not a SELECT-then-INSERT: two signups racing on
    // the same address is ordinary, and the check-then-write version lets both
    // through. The unique index is the arbiter, so exactly one wins.
    const result = await this.pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, password_hash, created_at`,
      [input.id, input.email, input.passwordHash],
    );

    const row = result.rows[0];
    if (!row) return { ok: false, reason: "email_taken" };
    return {
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        createdAt: toIso(row.created_at),
      },
    };
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, created_at FROM users WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: toIso(row.created_at) };
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, created_at FROM users WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: toIso(row.created_at) };
  }

  /** Sessions and trips cascade from users.id (migration 0003), so this takes
   * the user's trips with it. See AuthStore.deleteUser — no route exposes it. */
  async deleteUser(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async createSession(input: { tokenHash: string; userId: string; expiresAt: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [input.tokenHash, input.userId, input.expiresAt],
    );
  }

  async findValidSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    // Expiry is in the WHERE clause, not checked after the fact: an expired row
    // that the sweep hasn't reclaimed yet must not authenticate anyone.
    const result = await this.pool.query(
      `SELECT token_hash, user_id, created_at, expires_at
       FROM sessions
       WHERE token_hash = $1 AND expires_at > $2`,
      [tokenHash, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: toIso(row.created_at),
      expiresAt: toIso(row.expires_at),
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    const result = await this.pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    return result.rowCount ?? 0;
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    const result = await this.pool.query(`DELETE FROM sessions WHERE expires_at <= $1`, [now.toISOString()]);
    return result.rowCount ?? 0;
  }

  /** Not part of AuthStore — only for scripts that need the process to exit
   * instead of holding the pool open. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
