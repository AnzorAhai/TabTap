import { basisPointsOf, convertMinor, type PaymentView, type SessionView } from "@tabtap/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BcvRateService, type FetchFn } from "../src/rates/bcv-rate.service";
import { createTestApp, DEMO_TENANT_ID, type TestApp } from "./support/test-app";

// Venezuelan payment methods: Pago Móvil, Zelle, Binance Pay and cash are paid outside
// TabTap and confirmed by a reported reference or by staff. Real PostgreSQL per test.

const TOTAL = 4284; // demo table-1, USD cents
const AREPA = "t1-arepa";
const bearer = (s: SessionView) => ({ Authorization: `Bearer ${s.token}` });

describe("offline payment methods", () => {
  let t: TestApp;
  let billId: string;
  beforeEach(async () => {
    t = await createTestApp({ SIMULATED_CHECK_SECONDS: "1" });
    billId = (await t.tableView()).bill.id;
  });
  afterEach(() => t.close());

  const proof = (paymentId: string, body: object) => t.http().post(`/payments/${paymentId}/proof`).send(body);
  const makeDue = () => t.db.query("UPDATE payments SET proof_submitted_at = now() - interval '1 minute'");

  it("adds IGTF on Zelle, holds the items longer, and settles when staff confirm", async () => {
    const payment = await t.payOk(billId, { mode: "full", method: "zelle" });
    const surcharge = basisPointsOf(TOTAL, 300);
    expect(payment).toMatchObject({
      status: "pending",
      flow: "proof",
      chargeCurrency: "USD",
      surchargeMinor: surcharge,
      chargeAmountMinor: TOTAL + surcharge,
      payTo: { email: "pagos@demo-restaurant.example", holderName: "Demo Restaurant LLC" },
    });
    expect(new Date(payment.expiresAt!).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

    await proof(payment.id, { reference: "x" }).expect(400);
    const reported = await proof(payment.id, { reference: "ZL-77812", payerName: "Ana Pérez" }).expect(200);
    expect(reported.body.proofSubmitted).toBe(true);

    const waiter = await t.signIn({ login: "waiter@demo.test", role: "waiter" });
    const list = await t.http().get(`/tenants/${DEMO_TENANT_ID}/payments`).set(bearer(waiter)).expect(200);
    expect(list.body[0]).toMatchObject({
      method: "zelle",
      awaitingReview: true,
      proof: { reference: "ZL-77812", payerName: "Ana Pérez" },
      surchargeMinor: surcharge,
    });

    // Zelle is verified by staff, so the simulator leaves it alone.
    await makeDue();
    expect(await t.payments.runSimulatedChecks()).toBe(0);

    const confirmed = await t
      .http()
      .post(`/tenants/${DEMO_TENANT_ID}/payments/${payment.id}/confirm`)
      .set(bearer(waiter))
      .expect(200);
    expect(confirmed.body.status).toBe("succeeded");
    expect((await t.tableView()).bill).toMatchObject({ status: "paid", paidMinor: TOTAL });
    const { rows } = await t.db.query("SELECT reviewed_by FROM payments WHERE id = $1", [payment.id]);
    expect(rows[0].reviewed_by).toBe(waiter.me.userId);
  });

  it("verifies Pago Móvil references with the demo simulator", async () => {
    const good = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "pago_movil" });
    expect(good).toMatchObject({ chargeCurrency: "VES", exchangeRate: "236.5", surchargeMinor: 0 });
    expect(good.chargeAmountMinor).toBe(convertMinor(1638, "USD", "VES", "236.5"));
    const bad = await t.payOk(billId, { mode: "items", itemIds: ["t1-cachapa"], method: "pago_movil" });

    await proof(good.id, { reference: "004512", payerPhone: "0414-1112233", payerBank: "0102" }).expect(200);
    await proof(bad.id, { reference: "120000" }).expect(200);
    expect(await t.payments.runSimulatedChecks()).toBe(0); // not due yet
    await makeDue();
    expect(await t.payments.runSimulatedChecks()).toBe(2);

    expect((await t.http().get(`/payments/${good.id}`)).body.status).toBe("succeeded");
    const failed = (await t.http().get(`/payments/${bad.id}`)).body as PaymentView;
    expect(failed).toMatchObject({ status: "failed", failureReason: "reference_not_found" });
    const view = await t.tableView();
    expect(view.bill.items.find((i) => i.id === AREPA)!.state).toBe("paid");
    expect(view.bill.items.find((i) => i.id === "t1-cachapa")!.state).toBe("available");
  });

  it("takes cash through the waiter: no reference, staff confirm or reject", async () => {
    const cash = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "cash_usd" });
    expect(cash).toMatchObject({ flow: "staff", surchargeMinor: basisPointsOf(1638, 300) });
    await proof(cash.id, { reference: "123456" }).expect(400);

    const manager = await t.signIn({ login: "manager@demo.test", role: "manager" });
    const rejected = await t
      .http()
      .post(`/tenants/${DEMO_TENANT_ID}/payments/${cash.id}/reject`)
      .set(bearer(manager))
      .send({ reason: "guest left" })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: "failed", failureReason: "rejected_by_staff: guest left" });
    await t
      .http()
      .post(`/tenants/${DEMO_TENANT_ID}/payments/${cash.id}/reject`)
      .set(bearer(manager))
      .send({})
      .expect(409);
    // Money that does turn up later is still recorded.
    await t.http().post(`/tenants/${DEMO_TENANT_ID}/payments/${cash.id}/confirm`).set(bearer(manager)).expect(200);
    expect((await t.tableView()).bill.paidMinor).toBe(1638);
  });

  it("doesn't let staff confirm card payments or other restaurants' payments", async () => {
    const card = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    await t.http().post(`/tenants/${DEMO_TENANT_ID}/payments/${card.id}/confirm`).set(bearer(owner)).expect(409);

    const zelle = await t.payOk(billId, { mode: "items", itemIds: ["t1-cachapa"], method: "zelle" });
    const { rows } = await t.db.query(
      `INSERT INTO tenants (name, country, default_currency) VALUES ('Other', 'VE', 'USD') RETURNING id`,
    );
    const other = await t.signIn({ login: "owner@other.test", role: "owner", tenantId: rows[0].id });
    await t.http().post(`/tenants/${rows[0].id}/payments/${zelle.id}/confirm`).set(bearer(other)).expect(404);
  });
});

describe("payment method settings", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  it("lets managers set methods and payee details, validating them", async () => {
    const manager = await t.signIn({ login: "manager@demo.test", role: "manager" });
    const waiter = await t.signIn({ login: "waiter@demo.test", role: "waiter" });
    const url = `/tenants/${DEMO_TENANT_ID}/payment-methods`;
    const current = (await t.http().get(url).set(bearer(waiter)).expect(200)).body;
    expect(current).toHaveLength(6);

    const methods = [
      {
        method: "pago_movil",
        enabled: true,
        surchargeBps: 0,
        details: { bank: "0102 Venezuela", phone: "0412-0000000", documentId: "J-12345678-9", junk: "x" },
      },
      { method: "cash_usd", enabled: true, surchargeBps: 300, details: {} },
      { method: "zelle", enabled: false, surchargeBps: 300, details: { email: "old@x.test", holderName: "Old" } },
    ];
    await t.http().put(url).set(bearer(waiter)).send({ methods }).expect(403);
    await t
      .http()
      .put(url)
      .set(bearer(manager))
      .send({ methods: [{ ...methods[0], details: { bank: "0102", phone: "1", documentId: "J-1" } }] })
      .expect(400);
    await t
      .http()
      .put(url)
      .set(bearer(manager))
      .send({ methods: methods.map((m) => ({ ...m, enabled: false })) })
      .expect(400);

    const saved = (await t.http().put(url).set(bearer(manager)).send({ methods }).expect(200)).body;
    expect(saved[0]).toMatchObject({
      method: "pago_movil",
      sortOrder: 1,
      details: { bank: "0102 Venezuela", phone: "0412-0000000", documentId: "J-12345678-9", verification: "staff" },
    });
    expect(saved[0].details).not.toHaveProperty("junk");
    expect((await t.tableView()).paymentMethods.map((m) => m.method)).toEqual(["pago_movil", "cash_usd"]);
  });

  it("reports platform fees per month for the restaurant and for the platform", async () => {
    const billId = (await t.tableView()).bill.id;
    await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
    await t.payOk(billId, { mode: "items", itemIds: ["t1-cachapa"], method: "card" });
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    const month = new Date().toISOString().slice(0, 7);

    const fees = await t.http().get(`/tenants/${DEMO_TENANT_ID}/fees?month=${month}`).set(bearer(owner)).expect(200);
    expect(fees.body).toEqual({
      month,
      rows: [
        {
          tenantId: DEMO_TENANT_ID,
          tenantName: "El Araguaney",
          currency: "USD",
          payments: 2,
          billAmountMinor: 1638 + 1008,
          feeMinor: basisPointsOf(1638, 150) + basisPointsOf(1008, 150),
        },
      ],
    });
    await t.http().get(`/tenants/${DEMO_TENANT_ID}/fees?month=2026-13`).set(bearer(owner)).expect(400);
    await t.http().get(`/platform/fees?month=${month}`).set(bearer(owner)).expect(403);
    const admin = await t.signIn({ login: "ops@tabtap.test", platformAdmin: true });
    expect((await t.http().get(`/platform/fees?month=${month}`).set(bearer(admin)).expect(200)).body.rows).toHaveLength(
      1,
    );
  });
});

describe("BCV exchange rate", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  const source =
    (body: unknown, status = 200): FetchFn =>
    async () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("stores the official rate for restaurants set to BCV when it changes", async () => {
    const bcv = t.app.get(BcvRateService);
    const fresh = {
      moneda: "USD",
      fuente: "oficial",
      promedio: 896.1225,
      fechaActualizacion: new Date().toISOString(),
    };

    expect(await bcv.refreshAll(source(fresh))).toBe(1);
    expect(await bcv.refreshAll(source(fresh))).toBe(0); // unchanged
    const view = await t.tableView();
    expect(view.paymentMethods[0]).toMatchObject({ method: "pago_movil", rate: "896.1225" });

    await expect(bcv.refreshAll(source({ ...fresh, promedio: "abc" }))).rejects.toThrow(/usable rate/);
    await expect(bcv.refreshAll(source({ ...fresh, fechaActualizacion: "2020-01-01T00:00:00Z" }))).rejects.toThrow(
      /stale/,
    );
    await expect(bcv.refreshAll(source({}, 503))).rejects.toThrow(/503/);

    // Restaurants on manual rates are left alone.
    await t.db.query("UPDATE tenants SET rate_source = 'manual'");
    expect(await bcv.refreshAll(source({ ...fresh, promedio: 900 }))).toBe(0);
  });
});
