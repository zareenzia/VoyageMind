/**
 * Applies migrations/*.sql against DATABASE_URL_UNPOOLED — the direct
 * connection, not the pooled one, since DDL has no business going through
 * PgBouncer transaction pooling. No ORM: plain SQL files, applied in filename
 * order, tracked in schema_migrations so re-running is a no-op. Run with
 * `npm run migrate`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "migrations");

async function main(): Promise<void> {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL_UNPOOLED") });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((row) => row.name),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`apply ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
