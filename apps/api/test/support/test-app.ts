import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { CreatePaymentRequest, PaymentView, TableBillView } from "@tabtap/shared";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { inject } from "vitest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import { APP_CONFIG, loadConfig, type AppConfig } from "../../src/config/app-config";
import { DB_POOL } from "../../src/database/database.module";
import { MockPOSConnector } from "../../src/integrations/pos/mock-pos.connector";
import { POS_CONNECTOR } from "../../src/integrations/pos/pos-connector.interface";
import { PaymentsService } from "../../src/payments/payments.service";
import { PosSyncService } from "../../src/payments/pos-sync.service";

export const ADMIN_TOKEN = "test-admin-token-0123456789abcdef0123456789";

const TEMPLATE_DB = "tabtap_template";

/** Clones the migrated template into a brand-new database and returns its URL. */
async function createDatabase(): Promise<string> {
  const serverUrl = inject("pgServerUrl");
  const name = `t_${randomUUID().replace(/-/g, "")}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    // Cloning needs the template to be idle; serialize clones across test files.
    await admin.query("SELECT pg_advisory_lock(42)");
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  return serverUrl.replace(/\/postgres$/, `/${name}`);
}

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  db: pg.Pool;
  pos: MockPOSConnector;
  payments: PaymentsService;
  posSync: PosSyncService;
  http: () => ReturnType<typeof request>;
  tableView: (qrToken?: string) => Promise<TableBillView>;
  /** POST /bills/:billId/payments; returns the raw response so tests can check errors. */
  pay: (billId: string, body: CreatePaymentRequest, idempotencyKey?: string) => Promise<request.Response>;
  /** Same, asserting 201, returning the payment. */
  payOk: (billId: string, body: CreatePaymentRequest) => Promise<PaymentView>;
  close: () => Promise<void>;
}

/** A full API instance on its own fresh database. Background jobs and rate limits are off. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const databaseUrl = await createDatabase();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: "https://guest.example.com",
    BACKGROUND_JOBS: "false",
    RATE_LIMIT_ENABLED: "false",
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    ...env,
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, rawBody: true });
  configureApp(app, config);
  await app.init();

  const http = () => request(app.getHttpServer());

  const pay = (billId: string, body: CreatePaymentRequest, idempotencyKey: string = randomUUID()) =>
    http().post(`/bills/${billId}/payments`).set("Idempotency-Key", idempotencyKey).send(body);

  return {
    app,
    config,
    db: app.get<pg.Pool>(DB_POOL),
    pos: app.get<MockPOSConnector>(POS_CONNECTOR),
    payments: app.get(PaymentsService),
    posSync: app.get(PosSyncService),
    http,
    tableView: async (qrToken = "table-1") => {
      const res = await http().get(`/tables/${qrToken}/bill`).expect(200);
      return res.body as TableBillView;
    },
    pay,
    payOk: async (billId, body) => {
      const res = await pay(billId, body);
      if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body as PaymentView;
    },
    close: () => app.close(),
  };
}
