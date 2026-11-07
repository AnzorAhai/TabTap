import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { DatabaseError } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { APP_CONFIG, loadConfig } from "../src/config/app-config";
import { DB_POOL } from "../src/database/database.module";

// Full HTTP stack (pipes, guards, filters, CORS, helmet) with the database
// replaced by a stub, so these tests need no running Postgres.
const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused/test",
  CORS_ORIGINS: "https://guest.example.com",
  BACKGROUND_JOBS: "false",
});

const pool = {
  query: vi.fn(),
  on: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

describe("API over HTTP", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(DB_POOL)
      .useValue(pool)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    expect(pool.end).toHaveBeenCalled();
  });

  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  const http = () => request(app.getHttpServer());

  it("GET /health is ok when the database answers", async () => {
    const res = await http().get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", checks: { database: "ok" } });
  });

  it("GET /health is 503 when the database is unreachable", async () => {
    pool.query.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const res = await http().get("/health").expect(503);
    expect(res.body).toMatchObject({ status: "error", checks: { database: "error" } });
  });

  it("rejects malformed ids before touching the database", async () => {
    await http().get("/bills/not-a-uuid").expect(400);
    await http().get("/payments/123/receipt").expect(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("validates request bodies, including unknown fields and limits", async () => {
    const billId = "6f1c2e9a-1111-4111-8111-111111111111";
    await http().put(`/bills/${billId}/equal-split`).send({ shareCount: 100000 }).expect(400);
    const res = await http()
      .post(`/bills/${billId}/payments`)
      .set("Idempotency-Key", "test-key-123")
      .send({ mode: "full", currency: "USD", sneaky: true })
      .expect(400);
    expect(res.body.message).toEqual(["property sneaky should not exist"]);
    await http()
      .post(`/bills/${billId}/payments`)
      .set("Idempotency-Key", "test-key-123")
      .send({ mode: "everything", currency: "USD" })
      .expect(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown table QR token", async () => {
    const res = await http().get("/tables/no-such-table/bill").expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: "Not Found" });
  });

  it("turns database errors caused by bad input into 4xx, not 500", async () => {
    const err = new DatabaseError("invalid input syntax for type uuid", 0, "error");
    err.code = "22P02";
    pool.query.mockRejectedValueOnce(err);
    await http().get("/tables/table-1/bill").expect(400);
  });

  it("allows CORS only for configured origins", async () => {
    const allowed = await http().get("/health").set("Origin", "https://guest.example.com");
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://guest.example.com");

    const denied = await http().get("/health").set("Origin", "https://evil.example.com");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends security headers and JSON errors for unknown routes", async () => {
    const res = await http().get("/definitely-not-a-route").expect(404);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toMatchObject({ statusCode: 404, error: "Not Found" });
  });
});
