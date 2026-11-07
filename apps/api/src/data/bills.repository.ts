import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { BillItem, BillStatus } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import type { PosBill } from "../integrations/pos/pos-connector.interface";
import type { BillRecord, TableContext } from "./records";

@Injectable()
export class BillsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Stores the POS's current view of a bill. Atomic, so concurrent first scans of a
   * table end up on the same row. Only POS-owned fields are overwritten; what TabTap
   * has collected (paid_minor) is never touched here.
   * `changed` is true when the bill is new or its POS contents differ from before.
   */
  async upsertFromPos(table: TableContext, pos: PosBill): Promise<{ bill: BillRecord; changed: boolean }> {
    const { rows } = await this.pool.query(
      `INSERT INTO bills (tenant_id, venue_id, table_id, external_pos_id, currency, items, service_charge_minor,
                          total_minor, pos_status, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9 = 'closed' THEN 'closed' ELSE 'open' END)
       ON CONFLICT (table_id, external_pos_id) DO UPDATE SET
         items = EXCLUDED.items,
         service_charge_minor = EXCLUDED.service_charge_minor,
         total_minor = EXCLUDED.total_minor,
         pos_status = EXCLUDED.pos_status,
         status = CASE
           WHEN EXCLUDED.pos_status = 'closed' THEN 'closed'
           WHEN bills.paid_minor >= EXCLUDED.total_minor AND bills.paid_minor > 0 THEN 'paid'
           WHEN bills.paid_minor > 0 THEN 'partially_paid'
           ELSE 'open'
         END,
         last_synced_at = now(),
         updated_at = CASE
           WHEN (bills.items, bills.service_charge_minor, bills.total_minor, bills.pos_status)
                IS DISTINCT FROM (EXCLUDED.items, EXCLUDED.service_charge_minor, EXCLUDED.total_minor, EXCLUDED.pos_status)
           THEN now() ELSE bills.updated_at END
       RETURNING *, (xmax = 0) AS inserted, (updated_at = now()) AS touched`,
      [
        table.tenantId,
        table.venueId,
        table.tableId,
        pos.externalId,
        pos.currency,
        JSON.stringify(pos.items),
        pos.serviceChargeMinor,
        pos.totalMinor,
        pos.status,
      ],
    );
    const row = rows[0];
    return { bill: mapBill(row), changed: Boolean(row.inserted) || Boolean(row.touched) };
  }

  async findById(billId: string, db: Queryable = this.pool): Promise<BillRecord> {
    const { rows } = await db.query(`SELECT * FROM bills WHERE id = $1`, [billId]);
    if (rows.length === 0) throw new NotFoundException(`Bill ${billId} not found`);
    return mapBill(rows[0]);
  }

  /** Locks the bill row until the transaction ends; every change to a bill's payments goes through this. */
  async lockById(db: Queryable, billId: string): Promise<BillRecord> {
    const { rows } = await db.query(`SELECT * FROM bills WHERE id = $1 FOR UPDATE`, [billId]);
    if (rows.length === 0) throw new NotFoundException(`Bill ${billId} not found`);
    return mapBill(rows[0]);
  }

  async addPaid(db: Queryable, billId: string, amountMinor: number): Promise<void> {
    await db.query(
      `UPDATE bills SET
         paid_minor = paid_minor + $2,
         status = CASE
           WHEN pos_status = 'closed' THEN 'closed'
           WHEN paid_minor + $2 >= total_minor THEN 'paid'
           ELSE 'partially_paid'
         END,
         updated_at = now()
       WHERE id = $1`,
      [billId, amountMinor],
    );
  }
}

function mapBill(row: Record<string, unknown>): BillRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    venueId: row.venue_id as string,
    tableId: row.table_id as string,
    externalPosId: row.external_pos_id as string,
    currency: row.currency as string,
    items: row.items as BillItem[],
    serviceChargeMinor: Number(row.service_charge_minor),
    totalMinor: Number(row.total_minor),
    paidMinor: Number(row.paid_minor),
    posStatus: row.pos_status as "open" | "closed",
    status: row.status as BillStatus,
    lastSyncedAt: row.last_synced_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
