import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_POOL } from "../src/database/database.module";
import type { TenantPool } from "../src/database/tenant-scope";
import { createTestApp, DEMO_TENANT_ID, type TestApp } from "./support/test-app";

// Queries here deliberately have no tenant filter: the database itself has to stop them.

describe("isolation between restaurants in the database", () => {
  let t: TestApp;
  let pool: TenantPool;
  let otherTenant: string;
  let billId: string;

  beforeEach(async () => {
    t = await createTestApp();
    pool = t.app.get<TenantPool>(DB_POOL);
    billId = (await t.tableView()).bill.id;
    await t.payOk(billId, { mode: "items", itemIds: ["t1-arepa"], method: "card" });
    const { rows } = await t.db.query(
      `INSERT INTO tenants (name, country, default_currency) VALUES ('Other', 'VE', 'USD') RETURNING id`,
    );
    otherTenant = rows[0].id;
  });
  afterEach(() => t.close());

  const asOther = <T>(fn: () => Promise<T>) => pool.runAsTenant(otherTenant, fn);
  const asDemo = <T>(fn: () => Promise<T>) => pool.runAsTenant(DEMO_TENANT_ID, fn);
  const count = async (table: string) =>
    (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

  it("hides every other restaurant's rows from a query with no filter", async () => {
    for (const table of [
      "payments",
      "bills",
      "receipts",
      "tables",
      "venues",
      "tenant_payment_methods",
      "memberships",
    ]) {
      expect(await asOther(() => count(table)), table).toBe(0);
    }
    expect(await asOther(() => count("tenants"))).toBe(1);
    expect(await asDemo(() => count("payments"))).toBe(1);
    expect(await asDemo(() => count("tables"))).toBe(6);
  });

  it("can't change or add to another restaurant's data", async () => {
    const changed = await asOther(() => pool.query(`UPDATE payments SET tip_minor = 999`));
    expect(changed.rowCount).toBe(0);
    const removed = await asOther(() => pool.query(`DELETE FROM bills`));
    expect(removed.rowCount).toBe(0);
    await expect(
      asOther(() =>
        pool.query(`INSERT INTO exchange_rates (tenant_id, base_currency, quote_currency, rate, source)
                    VALUES ('${DEMO_TENANT_ID}', 'USD', 'VES', 1, 'manual')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("also applies inside transactions and across awaited calls", async () => {
    const seen = await asOther(async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await new Promise((resolve) => setTimeout(resolve, 5));
        const { rows } = await client.query("SELECT count(*)::int AS n FROM payments");
        await client.query("COMMIT");
        return rows[0].n as number;
      } finally {
        client.release();
      }
    });
    expect(seen).toBe(0);
  });

  it("keeps concurrent requests of different restaurants apart", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? asDemo : asOther)(() => count("payments"))),
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => (i % 2 ? 1 : 0)));
  });

  it("gives the connection back unrestricted, even after a failure", async () => {
    await expect(
      asOther(async () => {
        await pool.query("SELECT 1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Settle the background clean-up, then use every connection in the pool.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const clients: pg.PoolClient[] = await Promise.all(Array.from({ length: 5 }, () => pool.connect()));
    for (const client of clients) {
      const { rows } = await client.query(
        `SELECT current_user <> 'tabtap_app' AS owner, current_setting('app.current_tenant_id', true) AS tenant`,
      );
      expect(rows[0].owner).toBe(true);
      expect(rows[0].tenant ?? "").toBe("");
      client.release();
    }
    expect((await pool.query("SELECT count(*)::int AS n FROM payments")).rows[0].n).toBe(1);
  });

  it("refuses a transaction inside a transaction on the shared connection", async () => {
    await expect(
      asOther(async () => {
        const outer = await pool.connect();
        await outer.query("BEGIN");
        const inner = await pool.connect();
        try {
          await inner.query("BEGIN");
        } finally {
          await outer.query("ROLLBACK");
        }
      }),
    ).rejects.toThrow(/Nested transaction/);
  });

  it("protects every table that holds a restaurant's data", async () => {
    const { rows } = await t.db.query(
      `SELECT c.table_name
       FROM information_schema.columns c
       JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND k.relkind = 'r'
         AND NOT (k.relrowsecurity AND EXISTS (
           SELECT 1 FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.table_name AND p.policyname = 'tenant_isolation'
         ))`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("runs real admin requests under the restricted role", async () => {
    const owner = await t.signIn({ login: "owner@demo.test", role: "owner" });
    const auth = { Authorization: `Bearer ${owner.token}` };
    const scoped = vi.spyOn(pool, "runAsTenant");
    await t.http().get(`/tenants/${DEMO_TENANT_ID}/payments`).set(auth).expect(200);
    expect(scoped).toHaveBeenCalledWith(DEMO_TENANT_ID, expect.any(Function));

    // An API-level miss can't reach another restaurant either: this table belongs to the demo.
    const { rows } = await t.db.query("SELECT id FROM tables WHERE tenant_id = $1 LIMIT 1", [DEMO_TENANT_ID]);
    const admin = await t.signIn({ login: "ops@tabtap.test", platformAdmin: true });
    await t
      .http()
      .patch(`/tenants/${otherTenant}/tables/${rows[0].id}`)
      .set({ Authorization: `Bearer ${admin.token}` })
      .send({ label: "Hijacked" })
      .expect(404);
    const after = await t.db.query("SELECT label FROM tables WHERE id = $1", [rows[0].id]);
    expect(after.rows[0].label).not.toBe("Hijacked");
  });
});
