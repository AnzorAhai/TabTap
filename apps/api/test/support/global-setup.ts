// Starts one throwaway PostgreSQL for the whole test run (real server binaries from
// the embedded-postgres package — no Docker needed) and builds a template database
// with every migration applied. Each test clones the template for a clean database.

import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";

export const TEMPLATE_DB = "tabtap_template";
const USER = "postgres";
const PASSWORD = "postgres";

declare module "vitest" {
  export interface ProvidedContext {
    /** Connection URL of the test server's maintenance database ("postgres"). */
    pgServerUrl: string;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(path.join(tmpdir(), "tabtap-test-pg-")),
    user: USER,
    password: PASSWORD,
    port,
    persistent: false,
    // UTF8 like production (the OS locale could otherwise pick e.g. WIN1251).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const serverUrl = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/postgres`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  const template = new pg.Client({ connectionString: serverUrl.replace(/\/postgres$/, `/${TEMPLATE_DB}`) });
  await template.connect();
  const migrationsDir = path.resolve(__dirname, "../../../../db/migrations");
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await template.query("BEGIN");
    await template.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    await template.query("COMMIT");
  }
  await template.end();

  project.provide("pgServerUrl", serverUrl);

  return async () => {
    await server.stop();
  };
}
