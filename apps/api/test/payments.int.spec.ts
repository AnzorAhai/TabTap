import { basisPointsOf, convertMinor, percentOf, type PaymentView, type TableBillView } from "@tabtap/shared";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BillEventsService } from "../src/events/bill-events.service";
import { ADMIN_TOKEN, createTestApp, type TestApp } from "./support/test-app";

// End-to-end over HTTP against a real PostgreSQL (one fresh database per test).
// Demo table "table-1" (mock POS): 4 lines, subtotal $34.00, IVA $5.44, service $3.40,
// total $42.84; "Arepa reina pepiada" costs $16.38 with its tax and share of service.

const TOTAL = 4284;
const AREPA = "t1-arepa";
const AREPA_TOTAL = 1638;

const lineTotal = (view: TableBillView, id: string) => view.bill.items.find((i) => i.id === id)!.lineTotalMinor;
const itemState = (view: TableBillView, id: string) => view.bill.items.find((i) => i.id === id)!.state;

describe("bill view", () => {
  let t: TestApp;
  beforeEach(async () => (t = await createTestApp()));
  afterEach(() => t.close());

  it("shows the POS bill with a breakdown and line totals that add up exactly", async () => {
    const view = await t.tableView();

    expect(view.bill).toMatchObject({
      tableLabel: "Table 1",
      currency: "USD",
      status: "open",
      subtotalMinor: 3400,
      taxMinor: 544,
      serviceChargeMinor: 340,
      totalMinor: TOTAL,
      paidMinor: 0,
      reservedMinor: 0,
      remainingMinor: TOTAL,
    });
    expect(view.bill.items.reduce((sum, i) => sum + i.lineTotalMinor, 0)).toBe(TOTAL);
    expect(lineTotal(view, AREPA)).toBe(AREPA_TOTAL);
    expect(view.modes).toEqual({ full: true, items: true, shares: false });
    expect(view.equalSplit).toBeNull();
    expect(view.paymentCurrencies).toEqual([
      { currency: "USD", rate: null, rateEffectiveAt: null },
      { currency: "VES", rate: "236.5", rateEffectiveAt: expect.any(String) },
    ]);
  });

  it("gives concurrent first scans of a table the same bill", async () => {
    const views = await Promise.all(Array.from({ length: 6 }, () => t.tableView()));
    expect(new Set(views.map((v) => v.bill.id)).size).toBe(1);
    const { rows } = await t.db.query("SELECT count(*)::int AS n FROM bills");
    expect(rows[0].n).toBe(1);
  });

  it("returns 404 for an unknown table", async () => {
    await t.http().get("/tables/nope/bill").expect(404);
  });
});

describe("paying (instant mock gateway)", () => {
  let t: TestApp;
  let billId: string;
  beforeEach(async () => {
    t = await createTestApp({ MOCK_PAYMENT_FLOW: "instant" });
    billId = (await t.tableView()).bill.id;
  });
  afterEach(() => t.close());

  it("pays for chosen items with the amount computed on the server", async () => {
    const payment = await t.payOk(billId, { mode: "items", itemIds: [AREPA], tipPercent: 10, currency: "USD" });

    expect(payment).toMatchObject({
      status: "succeeded",
      mode: "items",
      amountMinor: AREPA_TOTAL,
      tipMinor: percentOf(AREPA_TOTAL, 10),
      currency: "USD",
      chargeCurrency: "USD",
      chargeAmountMinor: AREPA_TOTAL + percentOf(AREPA_TOTAL, 10),
      exchangeRate: null,
      itemIds: [AREPA],
    });
    const { rows } = await t.db.query("SELECT platform_fee_minor FROM payments WHERE id = $1", [payment.id]);
    expect(Number(rows[0].platform_fee_minor)).toBe(basisPointsOf(AREPA_TOTAL, 150));

    const view = await t.tableView();
    expect(itemState(view, AREPA)).toBe("paid");
    expect(view.bill).toMatchObject({
      status: "partially_paid",
      paidMinor: AREPA_TOTAL,
      remainingMinor: TOTAL - AREPA_TOTAL,
    });

    const receipt = await t.http().get(`/payments/${payment.id}/receipt`).expect(200);
    expect(receipt.body).toMatchObject({
      tableLabel: "Table 1",
      mode: "items",
      items: [{ name: "Arepa reina pepiada", quantity: 2, lineTotalMinor: AREPA_TOTAL }],
      amountMinor: AREPA_TOTAL,
    });
  });

  it("never lets an item be paid twice", async () => {
    await t.payOk(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });
    const again = await t.pay(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain("Arepa reina pepiada");
  });

  it("lets exactly one of two guests racing for the same item win", async () => {
    const results = await Promise.all([
      t.pay(billId, { mode: "items", itemIds: [AREPA, "t1-cachapa"], currency: "USD" }),
      t.pay(billId, { mode: "items", itemIds: [AREPA], currency: "USD" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await t.tableView()).bill.paidMinor).toBe(
      (results.find((r) => r.status === 201)!.body as PaymentView).amountMinor,
    );
  });

  it("returns the same payment when a request is retried with the same idempotency key", async () => {
    const key = randomUUID();
    const body = { mode: "full", currency: "USD" } as const;
    const [a, b] = await Promise.all([t.pay(billId, body, key), t.pay(billId, body, key)]);
    const c = await t.pay(billId, body, key);
    expect(new Set([a.body.id, b.body.id, c.body.id]).size).toBe(1);
    const { rows } = await t.db.query("SELECT count(*)::int AS n FROM payments");
    expect(rows[0].n).toBe(1);
  });

  it("requires an idempotency key and ignores client-sent amounts", async () => {
    await t.http().post(`/bills/${billId}/payments`).send({ mode: "full", currency: "USD" }).expect(400);
    const res = await t.pay(billId, { mode: "full", currency: "USD", amountMinor: 1 } as never);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("property amountMinor should not exist");
  });

  it("pays exactly the remaining amount in full mode, and nothing after that", async () => {
    await t.payOk(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });
    const full = await t.payOk(billId, { mode: "full", currency: "USD" });
    expect(full.amountMinor).toBe(TOTAL - AREPA_TOTAL);

    const view = await t.tableView();
    expect(view.bill).toMatchObject({ status: "paid", paidMinor: TOTAL, remainingMinor: 0 });
    expect(view.modes).toEqual({ full: false, items: false, shares: false });
    expect(view.bill.items.every((i) => i.state === "paid")).toBe(true);

    const again = await t.pay(billId, { mode: "full", currency: "USD" });
    expect(again.status).toBe(409);
  });

  it("converts to bolívares at the restaurant's rate; the fee stays on the USD amount", async () => {
    await t
      .http()
      .post("/admin/exchange-rates")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ baseCurrency: "USD", quoteCurrency: "VES", rate: "240.125" })
      .expect(201);

    const payment = await t.payOk(billId, { mode: "full", tipPercent: 10, currency: "VES" });
    const tip = percentOf(TOTAL, 10);
    expect(payment).toMatchObject({
      amountMinor: TOTAL,
      tipMinor: tip,
      currency: "USD",
      chargeCurrency: "VES",
      exchangeRate: "240.125",
      chargeAmountMinor: convertMinor(TOTAL + tip, "USD", "VES", "240.125"),
    });
    const { rows } = await t.db.query("SELECT platform_fee_minor FROM payments WHERE id = $1", [payment.id]);
    expect(Number(rows[0].platform_fee_minor)).toBe(basisPointsOf(TOTAL, 150));
  });

  it("rejects currencies the restaurant doesn't accept", async () => {
    const res = await t.pay(billId, { mode: "full", currency: "EUR" });
    expect(res.status).toBe(409);
  });

  it("queues the POS update with the payment and delivers it, retrying while the POS is down", async () => {
    const payment = await t.payOk(billId, { mode: "full", currency: "USD" });

    const realMarkPaid = t.pos.markPaid.bind(t.pos);
    t.pos.markPaid = () => Promise.reject(new Error("POS offline"));
    expect(await t.posSync.processDue()).toBe(0);
    let job = (await t.db.query("SELECT * FROM pos_sync_jobs WHERE payment_id = $1", [payment.id])).rows[0];
    expect(job).toMatchObject({ status: "pending", attempts: 1, last_error: "POS offline" });
    expect(new Date(job.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    t.pos.markPaid = realMarkPaid;
    await t.db.query("UPDATE pos_sync_jobs SET next_attempt_at = now()");
    expect(await t.posSync.processDue()).toBe(1);
    job = (await t.db.query("SELECT * FROM pos_sync_jobs WHERE payment_id = $1", [payment.id])).rows[0];
    expect(job.status).toBe("done");
    expect(t.pos.markedPayments.get(payment.id)).toMatchObject({
      amountMinor: TOTAL,
      externalBillId: "demo-ve-bill-1",
    });
  });
});

describe("equal split", () => {
  let t: TestApp;
  let billId: string;
  beforeEach(async () => {
    t = await createTestApp({ MOCK_PAYMENT_FLOW: "instant" });
    billId = (await t.tableView()).bill.id;
  });
  afterEach(() => t.close());

  const setSplit = (shareCount: number) => t.http().put(`/bills/${billId}/equal-split`).send({ shareCount });

  it("previews shares that add up to the bill, fixes them on the first payment and covers it exactly", async () => {
    const preview = (await setSplit(3).expect(200)).body as TableBillView;
    expect(preview.equalSplit).toMatchObject({ shareCount: 3, frozen: false });
    expect(preview.equalSplit!.shares.map((s) => s.amountMinor)).toEqual([1428, 1428, 1428]);
    expect(preview.modes.shares).toBe(true);

    const first = await t.payOk(billId, { mode: "shares", shareCount: 1, currency: "USD" });
    expect(first).toMatchObject({ amountMinor: 1428, shareIndices: [0] });

    const frozen = await t.tableView();
    expect(frozen.equalSplit!.frozen).toBe(true);
    expect(frozen.equalSplit!.shares.map((s) => s.state)).toEqual(["paid", "available", "available"]);
    expect(frozen.modes).toEqual({ full: true, items: false, shares: true });

    expect((await t.pay(billId, { mode: "items", itemIds: [AREPA], currency: "USD" })).status).toBe(409);
    expect((await setSplit(4)).status).toBe(409);
    expect((await t.http().delete(`/bills/${billId}/equal-split`)).status).toBe(409);

    const rest = await t.payOk(billId, { mode: "shares", shareCount: 2, currency: "USD" });
    expect(rest).toMatchObject({ amountMinor: 2856, shareIndices: [1, 2] });
    expect((await t.tableView()).bill).toMatchObject({ status: "paid", paidMinor: TOTAL, remainingMinor: 0 });
  });

  it("splits only what is left after someone paid their own items", async () => {
    await t.payOk(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });
    const view = (await setSplit(2).expect(200)).body as TableBillView;
    expect(view.equalSplit!.shares.map((s) => s.amountMinor)).toEqual([1323, 1323]); // (4284 − 1638) / 2

    await t.payOk(billId, { mode: "shares", shareCount: 2, currency: "USD" });
    expect((await t.tableView()).bill).toMatchObject({ paidMinor: TOTAL, remainingMinor: 0 });
  });

  it("rejects asking for more shares than are left", async () => {
    await setSplit(2).expect(200);
    await t.payOk(billId, { mode: "shares", shareCount: 1, currency: "USD" });
    const res = await t.pay(billId, { mode: "shares", shareCount: 2, currency: "USD" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Only 1 share(s) left to pay");
  });
});

describe("pending payments (manual mock gateway, like Pago Móvil)", () => {
  let t: TestApp;
  let billId: string;
  beforeEach(async () => {
    t = await createTestApp({ MOCK_PAYMENT_FLOW: "manual", PAYMENT_HOLD_MINUTES: "10" });
    billId = (await t.tableView()).bill.id;
  });
  afterEach(() => t.close());

  const confirm = (paymentId: string, outcome: "succeeded" | "failed") =>
    t.http().post(`/payments/${paymentId}/mock-confirm`).send({ outcome }).expect(200);

  it("holds items while pending and settles on confirmation", async () => {
    const payment = await t.payOk(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });
    expect(payment.status).toBe("pending");
    expect(new Date(payment.expiresAt!).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    const held = await t.tableView();
    expect(itemState(held, AREPA)).toBe("reserved");
    expect(held.bill).toMatchObject({ paidMinor: 0, reservedMinor: AREPA_TOTAL, remainingMinor: TOTAL - AREPA_TOTAL });
    expect((await t.pay(billId, { mode: "items", itemIds: [AREPA], currency: "USD" })).status).toBe(409);
    const full = await t.payOk(billId, { mode: "full", currency: "USD" });
    expect(full.amountMinor).toBe(TOTAL - AREPA_TOTAL); // full mode skips what others are paying

    const confirmed = await confirm(payment.id, "succeeded");
    expect(confirmed.body.status).toBe("succeeded");
    expect(itemState(await t.tableView(), AREPA)).toBe("paid");
  });

  it("releases the hold when the payment fails or is canceled", async () => {
    const a = await t.payOk(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });
    await confirm(a.id, "failed");
    expect(itemState(await t.tableView(), AREPA)).toBe("available");

    const b = await t.payOk(billId, { mode: "full", currency: "USD" });
    expect((await t.tableView()).modes).toEqual({ full: false, items: false, shares: false });
    const canceled = await t.http().post(`/payments/${b.id}/cancel`).expect(200);
    expect(canceled.body.status).toBe("canceled");
    expect((await t.tableView()).bill.remainingMinor).toBe(TOTAL);
    await t.http().post(`/payments/${b.id}/cancel`).expect(409);
  });

  it("expires holds, and still records money that arrives late", async () => {
    const payment = await t.payOk(billId, { mode: "items", itemIds: [AREPA], currency: "USD" });

    expect(await t.payments.expireDue(new Date(Date.now() + 11 * 60_000))).toBe(1);
    const afterExpiry = await t.tableView();
    expect(itemState(afterExpiry, AREPA)).toBe("available");
    expect((await t.http().get(`/payments/${payment.id}`)).body.status).toBe("expired");

    const late = await confirm(payment.id, "succeeded");
    expect(late.body.status).toBe("succeeded");
    expect((await t.tableView()).bill.paidMinor).toBe(AREPA_TOTAL);
  });

  it("lets only one of two simultaneous full payments through", async () => {
    const results = await Promise.all([
      t.pay(billId, { mode: "full", currency: "USD" }),
      t.pay(billId, { mode: "full", currency: "USD" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("notifies listeners of the bill on every change", async () => {
    const seen: string[] = [];
    const subscription = t.app
      .get(BillEventsService)
      .changesFeed()
      .subscribe((id) => seen.push(id));
    const payment = await t.payOk(billId, { mode: "full", currency: "USD" });
    await confirm(payment.id, "succeeded");
    subscription.unsubscribe();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen)).toEqual(new Set([billId]));
  });
});

describe("admin exchange rates", () => {
  let t: TestApp;
  afterEach(() => t.close());

  it("requires the admin token to change a rate", async () => {
    t = await createTestApp();
    const body = { baseCurrency: "USD", quoteCurrency: "VES", rate: "250" };
    await t.http().post("/admin/exchange-rates").send(body).expect(401);
    await t.http().post("/admin/exchange-rates").set("Authorization", "Bearer wrong").send(body).expect(401);
    await t
      .http()
      .post("/admin/exchange-rates")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ ...body, rate: "0" })
      .expect(400);
    await t.http().post("/admin/exchange-rates").set("Authorization", `Bearer ${ADMIN_TOKEN}`).send(body).expect(201);
    const rates = await t.http().get("/admin/exchange-rates").expect(200);
    expect(rates.body).toEqual([expect.objectContaining({ baseCurrency: "USD", quoteCurrency: "VES", rate: "250" })]);
  });

  it("is disabled when no admin token is configured", async () => {
    t = await createTestApp({ ADMIN_API_TOKEN: "" });
    await t
      .http()
      .post("/admin/exchange-rates")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ baseCurrency: "USD", quoteCurrency: "VES", rate: "250" })
      .expect(403);
  });
});
