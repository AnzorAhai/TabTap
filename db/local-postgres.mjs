// Runs a real PostgreSQL 17 for local development without Docker, using the server
// binaries from the embedded-postgres npm package. Data persists in .local/postgres.
//
//   npm run db:local        (leave it running; Ctrl+C stops the server)
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/tabtap
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);
const DATABASE = "tabtap";
const databaseDir = path.join(import.meta.dirname, "..", ".local", "postgres");

const server = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
  console.log(`Creating a new cluster in ${databaseDir}...`);
  await server.initialise();
}
await server.start();

const admin = new pg.Client({ connectionString: `postgresql://postgres:postgres@localhost:${PORT}/postgres` });
await admin.connect();
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
if (rowCount === 0) await admin.query(`CREATE DATABASE ${DATABASE}`);
await admin.end();

console.log(`PostgreSQL is running. DATABASE_URL=postgresql://postgres:postgres@localhost:${PORT}/${DATABASE}`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
