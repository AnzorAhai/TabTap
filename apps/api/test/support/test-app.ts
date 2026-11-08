import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { CreatePaymentRequest, PaymentView, SessionView, StaffRole, TableBillView } from "@tabtap/shared";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { inject } from "vitest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import { hashPassword } from "../../src/auth/crypto";
import { APP_CONFIG, loadConfig, type AppConfig } from "../../src/config/app-config";
import { DB_POOL } from "../../src/database/database.module";
import { MockPOSConnector } from "../../src/integrations/pos/mock-pos.connector";
import { POS_CONNECTOR } from "../../src/integrations/pos/pos-connector.interface";
import { PaymentsService } from "../../src/payments/payments.service";
import { PosSyncService } from "../../src/payments/pos-sync.service";

/** The seeded demo restaurant (migration 0002). */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";
export const TEST_PASSWORD = "correct horse battery";

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
  /** QR token of a demo table by its POS reference ("table-1" .. "table-3"). */
  qrToken: (posTableRef?: string) => Promise<string>;
  /** Guest view of a demo table, by its POS reference. */
  tableView: (posTableRef?: string) => Promise<TableBillView>;
  /** Creates a staff account with TEST_PASSWORD, signs it in and returns the session. */
  signIn: (opts: {
    email: string;
    role?: StaffRole;
    tenantId?: string;
    platformAdmin?: boolean;
  }) => Promise<SessionView>;
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

  const db = app.get<pg.Pool>(DB_POOL);
  const qrToken = async (posTableRef = "table-1") => {
    const { rows } = await db.query("SELECT qr_token FROM tables WHERE pos_table_ref = $1", [posTableRef]);
    return rows[0].qr_token as string;
  };

  const pay = (billId: string, body: CreatePaymentRequest, idempotencyKey: string = randomUUID()) =>
    http().post(`/bills/${billId}/payments`).set("Idempotency-Key", idempotencyKey).send(body);

  return {
    app,
    config,
    db,
    pos: app.get<MockPOSConnector>(POS_CONNECTOR),
    payments: app.get(PaymentsService),
    posSync: app.get(PosSyncService),
    http,
    qrToken,
    tableView: async (posTableRef = "table-1") => {
      const res = await http()
        .get(`/tables/${await qrToken(posTableRef)}/bill`)
        .expect(200);
      return res.body as TableBillView;
    },
    signIn: async ({ email, role, tenantId, platformAdmin = false }) => {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, is_platform_admin) VALUES ($1, $2, $3) RETURNING id`,
        [email, await hashPassword(TEST_PASSWORD), platformAdmin],
      );
      if (role) {
        await db.query("INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)", [
          rows[0].id,
          tenantId ?? DEMO_TENANT_ID,
          role,
        ]);
      }
      const res = await http().post("/auth/login").send({ email, password: TEST_PASSWORD }).expect(200);
      return res.body as SessionView;
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
