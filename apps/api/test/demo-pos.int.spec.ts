import type { DemoPosTableView, DemoPosView, LiveTableView, SessionView, TenantSettingsView } from "@tabtap/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, DEMO_TENANT_ID, type TestApp } from "./support/test-app";

// The demo POS: a waiter punches an order, guests scan and pay, the POS screen follows.

const tenant = `/tenants/${DEMO_TENANT_ID}`;
const pos = `${tenant}/demo-pos`;
const bearer = (s: SessionView) => ({ Authorization: `Bearer ${s.token}` });

describe("demo POS", () => {
  let t: TestApp;
  let owner: SessionView;
  let waiter: SessionView;

  beforeEach(async () => {
    t = await createTestApp({ POS_CONNECTOR_TYPE: "demo" });
    owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    waiter = await t.signIn({ login: "waiter@demo.test", role: "waiter" });
  });
  afterEach(() => t.close());

  const view = async (session = waiter) =>
    (await t.http().get(pos).set(bearer(session)).expect(200)).body as DemoPosView;
  const tableOf = (v: DemoPosView, label = "Mesa 1"): DemoPosTableView => v.tables.find((x) => x.label === label)!;

  async function order(...dishes: string[]): Promise<{ tableId: string; v: DemoPosView }> {
    let v = await view();
    const { tableId } = tableOf(v);
    for (const dish of dishes) {
      const menuItemId = v.menu.find((m) => m.name === dish)!.id;
      v = (await t.http().post(`${pos}/tables/${tableId}/lines`).set(bearer(waiter)).send({ menuItemId }).expect(200))
        .body as DemoPosView;
    }
    return { tableId, v };
  }

  const guestBill = async () => t.http().get(`/tables/${await t.qrToken("table-1")}/bill`);
  const removeLine = (tableId: string, lineId: string) =>
    t.http().delete(`${pos}/tables/${tableId}/lines/${lineId}`).set(bearer(waiter));
  const closeTable = (tableId: string) => t.http().post(`${pos}/tables/${tableId}/close`).set(bearer(waiter));

  it("offers a Venezuelan menu in the bill currency with the current rate", async () => {
    await t.db.query(`UPDATE exchange_rates SET rate = 236.5 WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    const v = await view();
    expect(v.currency).toBe("USD");
    expect(v.rate).toEqual({ currency: "VES", value: "236.5" });
    expect(v.menu.find((m) => m.name === "Pabellón criollo")).toMatchObject({ category: "Platos", priceMinor: 1200 });
    expect(v.tables.map((x) => x.label)).toEqual(["Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4", "Mesa 5", "Mesa 6"]);
    expect(v.tables.every((x) => x.order === null)).toBe(true);
    expect(tableOf(v).guestUrl).toContain(await t.qrToken("table-1"));
  });

  it("shows guests nothing until the waiter orders, then the bill with IVA and service", async () => {
    expect((await guestBill()).status).toBe(404);

    await order("Arepa reina pepiada", "Arepa reina pepiada", "Papelón con limón");

    const { body, status } = await guestBill();
    expect(status).toBe(200);
    // One row per portion, so that two guests can each pay for their own arepa.
    expect(body.bill.items.map((i: { name: string; quantity: number }) => [i.name, i.quantity])).toEqual([
      ["Arepa reina pepiada", 1],
      ["Arepa reina pepiada", 1],
      ["Papelón con limón", 1],
    ]);
    expect(body.bill).toMatchObject({
      subtotalMinor: 1550,
      taxMinor: 104 + 104 + 40,
      serviceChargeMinor: 155,
      totalMinor: 1550 + 248 + 155,
      currency: "USD",
    });
  });

  it("follows guests' payments: paid lines, held lines and tips", async () => {
    const { v: ordered } = await order("Pabellón criollo", "Hallaca", "Malta");
    const { body: guest } = await guestBill();
    const [pabellon, hallaca] = guest.bill.items as { id: string; lineTotalMinor: number }[];
    await t.payOk(guest.bill.id, { mode: "items", itemIds: [pabellon.id], tipPercent: 10, method: "card" });
    await t.payOk(guest.bill.id, { mode: "items", itemIds: [hallaca.id], method: "cash_usd" });

    const row = tableOf(await view()).order!;
    expect(row.billId).toBe(tableOf(ordered).order!.billId);
    expect(row.lines.map((l) => l.state)).toEqual(["paid", "reserved", "available"]);
    expect(row).toMatchObject({
      status: "partially_paid",
      paidMinor: pabellon.lineTotalMinor,
      reservedMinor: hallaca.lineTotalMinor,
      tipMinor: Math.round(pabellon.lineTotalMinor / 10),
    });
    expect(row.payments.map((p) => [p.method, p.status])).toEqual([
      ["cash_usd", "pending"],
      ["card", "succeeded"],
    ]);

    const live = (await t.http().get(`${tenant}/tables/live`).set(bearer(waiter)).expect(200)).body as LiveTableView[];
    expect(live.find((x) => x.label === "Mesa 1")!.bill).toMatchObject({ paidMinor: pabellon.lineTotalMinor });
  });

  it("takes lines off until someone starts paying; removing the last cancels the order", async () => {
    const { tableId, v } = await order("Malta", "Quesillo");
    const [malta, quesillo] = tableOf(v).order!.lines;

    const after = (await removeLine(tableId, malta.id).expect(200)).body as DemoPosView;
    expect(tableOf(after).order!.lines.map((l) => l.name)).toEqual(["Quesillo"]);
    expect((await guestBill()).body.bill.items).toHaveLength(1);
    await removeLine(tableId, malta.id).expect(404);

    const emptied = (await removeLine(tableId, quesillo.id).expect(200)).body as DemoPosView;
    expect(tableOf(emptied).order).toBeNull();
    expect((await guestBill()).status).toBe(404);

    const again = await order("Malta", "Quesillo");
    const { body: guest } = await guestBill();
    await t.payOk(guest.bill.id, { mode: "items", itemIds: [guest.bill.items[0].id], method: "cash_usd" });
    await removeLine(again.tableId, tableOf(again.v).order!.lines[1].id).expect(409);
  });

  it("adds concurrent lines to one order", async () => {
    const v = await view();
    const { tableId } = tableOf(v);
    const menuItemId = v.menu[0].id;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        t.http().post(`${pos}/tables/${tableId}/lines`).set(bearer(waiter)).send({ menuItemId }).expect(200),
      ),
    );
    expect(tableOf(await view()).order!.lines).toHaveLength(6);
    const { rows } = await t.db.query("SELECT count(*)::int AS n FROM demo_orders WHERE status = 'open'");
    expect(rows[0].n).toBe(1);
  });

  it("closes the table, and the next order is a new bill", async () => {
    const { tableId, v } = await order("Malta");
    const firstBill = tableOf(v).order!.billId;

    const closed = (await closeTable(tableId).expect(200)).body as DemoPosView;
    expect(tableOf(closed).order).toBeNull();
    expect((await guestBill()).status).toBe(404);
    const live = (await t.http().get(`${tenant}/tables/live`).set(bearer(waiter))).body as LiveTableView[];
    expect(live.find((x) => x.label === "Mesa 1")!.bill).toBeNull();
    await closeTable(tableId).expect(404);

    const { v: next } = await order("Quesillo");
    expect(tableOf(next).order!.billId).not.toBe(firstBill);
    expect((await guestBill()).body.bill.items).toHaveLength(1);
  });

  it("resets to a clean restaurant, keeping tables, QR codes and menu", async () => {
    const qr = await t.qrToken("table-1");
    const { v } = await order("Malta");
    const { body: guest } = await guestBill();
    await t.payOk(guest.bill.id, { mode: "full", method: "card" });
    expect(tableOf(v).order).not.toBeNull();

    await t.http().post(`${pos}/reset`).set(bearer(waiter)).expect(403);
    const after = (await t.http().post(`${pos}/reset`).set(bearer(owner)).expect(200)).body as DemoPosView;

    expect(after.tables.every((x) => x.order === null)).toBe(true);
    expect(after.menu).toHaveLength(v.menu.length);
    expect(await t.qrToken("table-1")).toBe(qr);
    const count = async (table: string) =>
      (await t.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
    expect(await count("payments")).toBe(0);
    expect(await count("receipts")).toBe(0);
    expect(await count("bills")).toBe(0);
    expect(await count("demo_orders")).toBe(0);
    expect(((await t.http().get(`${tenant}/summary`).set(bearer(owner))).body as { totals: unknown[] }).totals).toEqual(
      [],
    );
  });

  it("exists only for the demo restaurant", async () => {
    const settings = async (url: string, s: SessionView) =>
      (await t.http().get(url).set(bearer(s)).expect(200)).body as TenantSettingsView;
    expect((await settings(tenant, waiter)).demoPos).toBe(true);

    const { rows } = await t.db.query(
      `INSERT INTO tenants (name, country, default_currency) VALUES ('Real', 'VE', 'USD') RETURNING id`,
    );
    const real = `/tenants/${rows[0].id}`;
    const realOwner = await t.signIn({ login: "owner@real.test", role: "owner", tenantId: rows[0].id });
    expect((await settings(real, realOwner)).demoPos).toBe(false);
    await t.http().get(`${real}/demo-pos`).set(bearer(realOwner)).expect(404);
    await t.http().post(`${real}/demo-pos/reset`).set(bearer(realOwner)).expect(404);

    // Another restaurant's staff can't touch the demo either.
    await t.http().post(`${pos}/reset`).set(bearer(realOwner)).expect(403);
  });

  it("doesn't accept another restaurant's table or an unknown dish", async () => {
    const v = await view();
    const menuItemId = v.menu[0].id;
    const { rows } = await t.db.query(
      `WITH o AS (INSERT INTO tenants (name, country, default_currency) VALUES ('Real', 'VE', 'USD') RETURNING id),
            ve AS (INSERT INTO venues (tenant_id, name, timezone) SELECT id, 'V', 'America/Caracas' FROM o RETURNING id, tenant_id)
       INSERT INTO tables (tenant_id, venue_id, label, qr_token, pos_table_ref)
       SELECT tenant_id, id, 'T', 'other-qr-token', 'x' FROM ve RETURNING id`,
    );
    await t.http().post(`${pos}/tables/${rows[0].id}/lines`).set(bearer(waiter)).send({ menuItemId }).expect(404);
    await t
      .http()
      .post(`${pos}/tables/${tableOf(v).tableId}/lines`)
      .set(bearer(waiter))
      .send({ menuItemId: "99999999-9999-9999-9999-999999999999" })
      .expect(404);
  });
});

describe("demo POS with another connector", () => {
  it("is switched off", async () => {
    const t = await createTestApp();
    try {
      const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
      const { body } = await t.http().get(tenant).set(bearer(owner)).expect(200);
      expect((body as TenantSettingsView).demoPos).toBe(false);
      await t.http().get(pos).set(bearer(owner)).expect(404);
    } finally {
      await t.close();
    }
  });
});
