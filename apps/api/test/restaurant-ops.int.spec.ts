import { basisPointsOf, type AdminPaymentView, type LiveTableView, type SessionView } from "@tabtap/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, DEMO_TENANT_ID, type TestApp } from "./support/test-app";

// What restaurant staff work with day to day: the live floor, the daily takings,
// the payment history and refunds. Real PostgreSQL per test.

const TOTAL = 4284; // demo table-1, USD cents
const AREPA = "t1-arepa"; // 1638
const CACHAPA = "t1-cachapa"; // 1008
const tenant = `/tenants/${DEMO_TENANT_ID}`;
const bearer = (s: SessionView) => ({ Authorization: `Bearer ${s.token}` });

describe("restaurant operations", () => {
  let t: TestApp;
  let billId: string;
  let owner: SessionView;
  let waiter: SessionView;

  beforeEach(async () => {
    t = await createTestApp();
    billId = (await t.tableView()).bill.id;
    owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    waiter = await t.signIn({ login: "waiter@demo.test", role: "waiter" });
  });
  afterEach(() => t.close());

  const get = (url: string, session = owner) => t.http().get(`${tenant}${url}`).set(bearer(session));
  const refund = (paymentId: string, body: object = {}, session = owner) =>
    t.http().post(`${tenant}/payments/${paymentId}/refund`).set(bearer(session)).send(body);
  const confirmCash = (paymentId: string) =>
    t.http().post(`${tenant}/payments/${paymentId}/confirm`).set(bearer(waiter)).expect(200);

  describe("daily summary", () => {
    it("adds up the day's settled payments, per bill currency and per method", async () => {
      await t.payOk(billId, { mode: "items", itemIds: [AREPA], tipPercent: 10, method: "card" });
      const cash = await t.payOk(billId, { mode: "items", itemIds: [CACHAPA], method: "cash_usd" });
      await t.payOk(billId, { mode: "items", itemIds: ["t1-tequenos"], method: "cash_ves" }); // not confirmed
      await confirmCash(cash.id);

      const { body } = await get("/summary").expect(200);
      expect(body.timeZone).toBe("America/Caracas");
      expect(body.totals).toEqual([
        {
          currency: "USD",
          payments: 2,
          amountMinor: 1638 + 1008,
          tipMinor: 164,
          feeMinor: basisPointsOf(1638, 150) + basisPointsOf(1008, 150),
        },
      ]);
      expect(body.byMethod).toEqual([
        { method: "card", chargeCurrency: "USD", payments: 1, chargeAmountMinor: 1638 + 164 },
        {
          method: "cash_usd",
          chargeCurrency: "USD",
          payments: 1,
          chargeAmountMinor: 1008 + basisPointsOf(1008, 300),
        },
      ]);
      expect(body.refunds).toEqual([]);
    });

    it("counts days in the restaurant's time zone", async () => {
      const payment = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
      // 02:00 UTC on Nov 8 is still 22:00 on Nov 7 in Caracas (UTC−4).
      await t.db.query("UPDATE payments SET settled_at = '2026-11-08T02:00:00Z' WHERE id = $1", [payment.id]);

      expect((await get("/summary?date=2026-11-07").expect(200)).body.totals).toHaveLength(1);
      expect((await get("/summary?date=2026-11-08").expect(200)).body.totals).toHaveLength(0);
    });

    it("is for managers and owners, and rejects impossible dates", async () => {
      await get("/summary", waiter).expect(403);
      await get("/summary?date=2026-02-31").expect(400);
      await get("/summary?date=yesterday").expect(400);
    });
  });

  describe("live tables", () => {
    const tableOne = async (session = waiter) =>
      ((await get("/tables/live", session).expect(200)).body as LiveTableView[]).find((x) => x.label === "Стол 1")!;

    it("shows each table's bill as it gets paid, held and confirmed", async () => {
      const { rows } = await t.db.query("SELECT label FROM tables WHERE pos_table_ref = 'table-1'");
      await t.db.query("UPDATE tables SET label = 'Стол 1' WHERE label = $1", [rows[0].label]);

      expect(await tableOne()).toMatchObject({
        isActive: true,
        bill: { status: "open", totalMinor: TOTAL, paidMinor: 0, reservedMinor: 0, remainingMinor: TOTAL },
      });

      await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
      const cash = await t.payOk(billId, { mode: "items", itemIds: [CACHAPA], method: "cash_usd" });
      expect((await tableOne()).bill).toMatchObject({
        status: "partially_paid",
        paidMinor: 1638,
        reservedMinor: 1008,
        remainingMinor: TOTAL - 1638 - 1008,
        awaitingReview: 1,
      });

      await confirmCash(cash.id);
      expect((await tableOne()).bill).toMatchObject({ paidMinor: 1638 + 1008, reservedMinor: 0, awaitingReview: 0 });
    });

    it("has no bill for a table nobody has opened", async () => {
      const live = (await get("/tables/live").expect(200)).body as LiveTableView[];
      expect(live).toHaveLength(6);
      expect(live.filter((x) => x.bill === null)).toHaveLength(5);
    });
  });

  describe("payment history", () => {
    it("filters by day, status and method, and pages", async () => {
      const card = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
      const cash = await t.payOk(billId, { mode: "items", itemIds: [CACHAPA], method: "cash_usd" });
      await t.db.query("UPDATE payments SET created_at = '2026-11-08T02:00:00Z' WHERE id = $1", [card.id]);
      await t.db.query("UPDATE payments SET created_at = '2026-11-08T12:00:00Z' WHERE id = $1", [cash.id]);
      const ids = async (query: string) =>
        ((await get(`/payments?${query}`).expect(200)).body as AdminPaymentView[]).map((p) => p.id);

      expect(await ids("from=2026-11-07&to=2026-11-07")).toEqual([card.id]); // Nov 7 in Caracas
      expect(await ids("from=2026-11-08")).toEqual([cash.id]);
      expect(await ids("to=2026-11-08")).toEqual([cash.id, card.id]);
      expect(await ids("status=succeeded")).toEqual([card.id]);
      expect(await ids("method=cash_usd")).toEqual([cash.id]);
      expect(await ids("limit=1")).toEqual([cash.id]);
      expect(await ids("limit=1&offset=1")).toEqual([card.id]);

      await get("/payments?status=nope").expect(400);
      await get("/payments?limit=99999").expect(400);
      await get("/payments?from=2026-13-01").expect(400);
    });
  });

  describe("refunds", () => {
    it("reopens what a card payment covered and takes it out of the takings and fees", async () => {
      const payment = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
      expect((await t.tableView()).bill.items.find((i) => i.id === AREPA)!.state).toBe("paid");

      const { body } = await refund(payment.id, { reason: "cobro al cliente equivocado" }).expect(200);
      expect(body.status).toBe("refunded");

      const view = await t.tableView();
      expect(view.bill).toMatchObject({ status: "open", paidMinor: 0, remainingMinor: TOTAL });
      expect(view.bill.items.find((i) => i.id === AREPA)!.state).toBe("available");
      const { rows } = await t.db.query("SELECT paid_minor, status FROM bills WHERE id = $1", [billId]);
      expect(rows[0]).toMatchObject({ paid_minor: "0", status: "open" });

      const summary = (await get("/summary").expect(200)).body;
      expect(summary.totals).toEqual([]);
      expect(summary.refunds).toEqual([{ currency: "USD", payments: 1, amountMinor: 1638 }]);
      const month = new Date().toISOString().slice(0, 7);
      expect((await get(`/fees?month=${month}`).expect(200)).body.rows).toEqual([]);

      const [listed] = (await get("/payments").expect(200)).body as AdminPaymentView[];
      expect(listed).toMatchObject({ status: "refunded", refundReason: "cobro al cliente equivocado" });
      expect(listed.refundedAt).not.toBeNull();
    });

    it("keeps the rest of a partly refunded bill paid, and a repeated refund changes nothing", async () => {
      const first = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "card" });
      await t.payOk(billId, { mode: "items", itemIds: [CACHAPA], method: "card" });

      await refund(first.id).expect(200);
      await refund(first.id).expect(200);
      expect((await t.tableView()).bill).toMatchObject({ status: "partially_paid", paidMinor: 1008 });
    });

    it("records who gave cash back", async () => {
      const cash = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "cash_usd" });
      await confirmCash(cash.id);
      await refund(cash.id).expect(200);
      const { rows } = await t.db.query("SELECT refunded_by, refunded_at FROM payments WHERE id = $1", [cash.id]);
      expect(rows[0].refunded_by).toBe(owner.me.userId);
      expect(rows[0].refunded_at).not.toBeNull();
      // Money already returned can't be "confirmed" again.
      await t.http().post(`${tenant}/payments/${cash.id}/confirm`).set(bearer(waiter)).expect(409);
    });

    it("only applies to completed payments of your own restaurant, by managers and owners", async () => {
      const pending = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "cash_usd" });
      await refund(pending.id).expect(409);

      const card = await t.payOk(billId, { mode: "items", itemIds: [CACHAPA], method: "card" });
      await refund(card.id, {}, waiter).expect(403);

      const { rows } = await t.db.query(
        `INSERT INTO tenants (name, country, default_currency) VALUES ('Other', 'VE', 'USD') RETURNING id`,
      );
      const other = await t.signIn({ login: "owner@other.test", role: "owner", tenantId: rows[0].id });
      await t.http().post(`/tenants/${rows[0].id}/payments/${card.id}/refund`).set(bearer(other)).send({}).expect(404);
      expect((await t.tableView()).bill.paidMinor).toBe(1008);
    });
  });

  it("tells guests how long each kind of method holds their items", async () => {
    const { paymentMethods } = await t.tableView();
    const hold = (method: string) => paymentMethods.find((m) => m.method === method)!.holdMinutes;
    expect(hold("card")).toBe(t.config.paymentHoldMinutes);
    expect(hold("pago_movil")).toBe(t.config.offlineHoldMinutes);
  });

  it("puts the method and surcharge on the receipt", async () => {
    const cash = await t.payOk(billId, { mode: "items", itemIds: [AREPA], method: "cash_usd" });
    await confirmCash(cash.id);
    const receipt = (await t.http().get(`/payments/${cash.id}/receipt`).expect(200)).body;
    expect(receipt).toMatchObject({
      method: "cash_usd",
      surchargeBps: 300,
      surchargeMinor: basisPointsOf(1638, 300),
      chargeAmountMinor: 1638 + basisPointsOf(1638, 300),
    });
  });
});
