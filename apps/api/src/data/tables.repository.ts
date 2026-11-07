import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import type { TableContext } from "./records";

const CONTEXT_SELECT = `
  SELECT t.id AS table_id, t.label, t.qr_token, t.pos_table_ref, t.is_active,
         tn.id AS tenant_id, tn.name AS tenant_name, tn.platform_fee_bps, tn.payment_currencies, tn.tip_percent_options,
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
    venueId: row.venue_id as string,
    venueName: row.venue_name as string,
    platformFeeBps: Number(row.platform_fee_bps),
    paymentCurrencies: row.payment_currencies as string[],
    tipPercentOptions: row.tip_percent_options as number[],
  };
}
