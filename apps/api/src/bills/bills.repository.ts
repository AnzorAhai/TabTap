import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { Bill, BillItem, BillStatus } from "@tabtap/shared";
import { DB_POOL } from "../database/database.module";
import { TableRow } from "../tables/tables.repository";

interface BillDbRow {
  id: string;
  tenant_id: string;
  venue_id: string;
  table_id: string;
  external_pos_id: string;
  currency: string;
  items: BillItem[];
  total_minor: string; // BIGINT arrives as a string from pg
  paid_minor: string;
  status: string;
  last_synced_at: Date;
}

@Injectable()
export class BillsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  // Bills are owned by the POS, not by TabTap — this stores the latest synced
  // snapshot, keyed by (table, external_pos_id), so splits/payments have a stable FK to point at.
  async upsertFromPosSnapshot(posBill: Bill, table: Pick<TableRow, "id" | "tenantId" | "venueId">): Promise<Bill> {
    const itemsJson = JSON.stringify(posBill.items);
    const existing = await this.pool.query(`SELECT id FROM bills WHERE external_pos_id = $1 AND table_id = $2`, [
      posBill.externalPosId,
      table.id,
    ]);

    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      await this.pool.query(
        `UPDATE bills SET items = $1, total_minor = $2, paid_minor = $3, status = $4, last_synced_at = now()
         WHERE id = $5`,
        [itemsJson, posBill.totalMinor, posBill.paidMinor, posBill.status, id],
      );
      return this.findById(id);
    }

    const inserted = await this.pool.query(
      `INSERT INTO bills (tenant_id, venue_id, table_id, external_pos_id, currency, items, total_minor, paid_minor, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        table.tenantId,
        table.venueId,
        table.id,
        posBill.externalPosId,
        posBill.currency,
        itemsJson,
        posBill.totalMinor,
        posBill.paidMinor,
        posBill.status,
      ],
    );
    return this.findById(inserted.rows[0].id);
  }

  async findById(billId: string): Promise<Bill> {
    const { rows } = await this.pool.query<BillDbRow>(`SELECT * FROM bills WHERE id = $1`, [billId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Bill ${billId} not found`);
    }
    return this.mapRow(rows[0]);
  }

  private mapRow(row: BillDbRow): Bill {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      venueId: row.venue_id,
      tableId: row.table_id,
      externalPosId: row.external_pos_id,
      currency: row.currency,
      items: row.items,
      totalMinor: Number(row.total_minor),
      paidMinor: Number(row.paid_minor),
      status: row.status as BillStatus,
      lastSyncedAt: row.last_synced_at.toISOString(),
    };
  }
}
