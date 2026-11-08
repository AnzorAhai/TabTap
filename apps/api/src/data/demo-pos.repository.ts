import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { DemoMenuItemView } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";

export interface DemoOrder {
  id: string;
  tableId: string;
  openedAt: Date;
  currency: string;
  lines: { id: string; name: string; priceMinor: number }[];
}

const OPEN_ORDERS = `
  SELECT o.id, o.table_id, o.opened_at, tn.default_currency,
         COALESCE(
           json_agg(json_build_object('id', l.id, 'name', l.name, 'priceMinor', l.price_minor) ORDER BY l.created_at, l.id)
             FILTER (WHERE l.id IS NOT NULL),
           '[]'
         ) AS lines
  FROM demo_orders o
  JOIN tenants tn ON tn.id = o.tenant_id
  JOIN tables t ON t.id = o.table_id
  LEFT JOIN demo_order_lines l ON l.order_id = o.id
  WHERE o.status = 'open'`;

/** Menu and orders of the demo POS. */
@Injectable()
export class DemoPosRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async listMenu(tenantId: string): Promise<DemoMenuItemView[]> {
    const { rows } = await this.pool.query(
      `SELECT id, category, name, price_minor FROM demo_menu_items WHERE tenant_id = $1 ORDER BY sort_order, name`,
      [tenantId],
    );
    return rows.map((r) => ({ id: r.id, category: r.category, name: r.name, priceMinor: Number(r.price_minor) }));
  }

  async findMenuItem(tenantId: string, id: string): Promise<DemoMenuItemView> {
    const { rows } = await this.pool.query(
      `SELECT id, category, name, price_minor FROM demo_menu_items WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!rows.length) throw new NotFoundException("Menu item not found");
    const r = rows[0];
    return { id: r.id, category: r.category, name: r.name, priceMinor: Number(r.price_minor) };
  }

  async findOpenByPosRef(venueId: string, posTableRef: string): Promise<DemoOrder | null> {
    const { rows } = await this.pool.query(
      `${OPEN_ORDERS} AND t.venue_id = $1 AND t.pos_table_ref = $2 GROUP BY o.id, tn.default_currency`,
      [venueId, posTableRef],
    );
    return rows.length ? mapOrder(rows[0]) : null;
  }

  async listOpen(tenantId: string): Promise<DemoOrder[]> {
    const { rows } = await this.pool.query(`${OPEN_ORDERS} AND o.tenant_id = $1 GROUP BY o.id, tn.default_currency`, [
      tenantId,
    ]);
    return rows.map(mapOrder);
  }

  /** Locks the table's open order until the transaction ends, opening one if there is none. */
  async lockOrOpen(db: Queryable, tenantId: string, tableId: string): Promise<string> {
    await db.query(
      `INSERT INTO demo_orders (tenant_id, table_id) VALUES ($1, $2)
       ON CONFLICT (table_id) WHERE status = 'open' DO NOTHING`,
      [tenantId, tableId],
    );
    return (await this.lockOpen(db, tableId))!;
  }

  async lockOpen(db: Queryable, tableId: string): Promise<string | null> {
    const { rows } = await db.query(`SELECT id FROM demo_orders WHERE table_id = $1 AND status = 'open' FOR UPDATE`, [
      tableId,
    ]);
    return rows.length ? (rows[0].id as string) : null;
  }

  async addLine(db: Queryable, tenantId: string, orderId: string, name: string, priceMinor: number): Promise<void> {
    await db.query(`INSERT INTO demo_order_lines (order_id, tenant_id, name, price_minor) VALUES ($1, $2, $3, $4)`, [
      orderId,
      tenantId,
      name,
      priceMinor,
    ]);
  }

  /** Returns how many lines the order has left, or null if it had no such line. */
  async removeLine(db: Queryable, orderId: string, lineId: string): Promise<number | null> {
    const { rowCount } = await db.query(`DELETE FROM demo_order_lines WHERE order_id = $1 AND id = $2`, [
      orderId,
      lineId,
    ]);
    if (rowCount === 0) return null;
    const { rows } = await db.query(`SELECT count(*)::int AS left FROM demo_order_lines WHERE order_id = $1`, [
      orderId,
    ]);
    return rows[0].left as number;
  }

  async close(db: Queryable, orderId: string): Promise<void> {
    await db.query(`UPDATE demo_orders SET status = 'closed', closed_at = now() WHERE id = $1`, [orderId]);
  }

  /** Deletes the restaurant's orders, bills and payments; returns the ids of the deleted bills. */
  async wipe(db: Queryable, tenantId: string): Promise<string[]> {
    // Payments, receipts, splits and POS sync jobs all go with their bill.
    const { rows } = await db.query(`DELETE FROM bills WHERE tenant_id = $1 RETURNING id`, [tenantId]);
    await db.query(`DELETE FROM demo_orders WHERE tenant_id = $1`, [tenantId]);
    return rows.map((r) => r.id as string);
  }
}

function mapOrder(row: Record<string, unknown>): DemoOrder {
  return {
    id: row.id as string,
    tableId: row.table_id as string,
    openedAt: row.opened_at as Date,
    currency: row.default_currency as string,
    lines: row.lines as DemoOrder["lines"],
  };
}
