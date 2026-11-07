// Applies db/migrations/*.sql in filename order, each in its own transaction,
// recording applied files in schema_migrations. Safe to run on every deploy:
// already-applied files are skipped, and an advisory lock keeps two instances
// starting at the same time from racing each other.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const migrationsDir = path.join(import.meta.dirname, "migrations");
// Arbitrary constant shared by every process that runs migrations.
const MIGRATION_LOCK_ID = 727274_001;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set((await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Applying ${file}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        count += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }
    console.log(count > 0 ? `Applied ${count} migration(s).` : "Migrations up to date.");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
