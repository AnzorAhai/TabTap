import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { newQrToken } from "../auth/crypto";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import type { TableContext } from "./records";

const CONTEXT_SELECT = `
  SELECT t.id AS table_id, t.label, t.qr_token, t.pos_table_ref, t.is_active,
         tn.id AS tenant_id, tn.name AS tenant_name, tn.status AS tenant_status, tn.platform_fee_bps, tn.payment_currencies, tn.tip_percent_options,
         v.id AS venue_id, v.name AS venue_name
  FROM tables t
  JOIN tenants tn ON tn.id = t.tenant_id
  JOIN venues v ON v.id = t.venue_id`;

@Injectable()
export class TablesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findContextByQrToken(qrToken: string, db: Queryable = this.pool): Promise<TableContext | null> {
    const { rows } = await db.query(`${CONTEXT_SELECT} WHERE t.qr_token = $1`, [qrToken]);
    return rows.length ? mapContext(rows[0]) : null;
  }

  async findContextByTableId(tableId: string, db: Queryable = this.pool): Promise<TableContext | null> {
    const { rows } = await db.query(`${CONTEXT_SELECT} WHERE t.id = $1`, [tableId]);
    return rows.length ? mapContext(rows[0]) : null;
  }

  async listByTenant(tenantId: string): Promise<TableContext[]> {
    const { rows } = await this.pool.query(`${CONTEXT_SELECT} WHERE t.tenant_id = $1 ORDER BY t.label`, [tenantId]);
    return rows.map(mapContext);
  }

  /** A table of this tenant, or 404 — never another restaurant's table. */
  async findInTenant(tenantId: string, tableId: string): Promise<TableContext> {
    const { rows } = await this.pool.query(`${CONTEXT_SELECT} WHERE t.tenant_id = $1 AND t.id = $2`, [
      tenantId,
      tableId,
    ]);
    if (!rows.length) throw new NotFoundException("Table not found");
    return mapContext(rows[0]);
  }

  async create(tenantId: string, venueId: string, label: string, posTableRef: string): Promise<string> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO tables (tenant_id, venue_id, label, qr_token, pos_table_ref) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, venueId, label, newQrToken(), posTableRef],
      );
      return rows[0].id as string;
    } catch (err) {
      throw uniqueRefConflict(err);
    }
  }

  async update(
    tenantId: string,
    tableId: string,
    changes: { label?: string; posTableRef?: string; isActive?: boolean },
  ): Promise<void> {
    try {
      const { rowCount } = await this.pool.query(
        `UPDATE tables SET
           label = COALESCE($3, label),
           pos_table_ref = COALESCE($4, pos_table_ref),
           is_active = COALESCE($5, is_active),
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, tableId, changes.label ?? null, changes.posTableRef ?? null, changes.isActive ?? null],
      );
      if (rowCount === 0) throw new NotFoundException("Table not found");
    } catch (err) {
      throw uniqueRefConflict(err);
    }
  }

  /** New random QR token; the old one (and any printed code with it) stops working at once. */
  async rotateQrToken(tenantId: string, tableId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE tables SET qr_token = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, tableId, newQrToken()],
    );
    if (rowCount === 0) throw new NotFoundException("Table not found");
  }
}

function uniqueRefConflict(err: unknown): unknown {
  if ((err as { code?: string }).code === "23505") {
    return new ConflictException("Another table in this venue already uses that POS table id");
  }
  return err;
}

function mapContext(row: Record<string, unknown>): TableContext {
  return {
    tableId: row.table_id as string,
    tableLabel: row.label as string,
    qrToken: row.qr_token as string,
    posTableRef: row.pos_table_ref as string,
    isActive: row.is_active as boolean,
    tenantId: row.tenant_id as string,
    tenantName: row.tenant_name as string,
    tenantActive: row.tenant_status === "active",
    venueId: row.venue_id as string,
    venueName: row.venue_name as string,
    platformFeeBps: Number(row.platform_fee_bps),
    paymentCurrencies: row.payment_currencies as string[],
    tipPercentOptions: row.tip_percent_options as number[],
  };
}
