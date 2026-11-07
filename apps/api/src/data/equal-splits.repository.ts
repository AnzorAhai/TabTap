import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import type { EqualSplitRecord } from "./records";

@Injectable()
export class EqualSplitsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findByBill(billId: string, db: Queryable = this.pool): Promise<EqualSplitRecord | null> {
    const { rows } = await db.query(`SELECT * FROM equal_splits WHERE bill_id = $1`, [billId]);
    return rows.length ? mapSplit(rows[0]) : null;
  }

  /** Creates the bill's split or changes its share count (callers check it isn't frozen). */
  async upsert(db: Queryable, tenantId: string, billId: string, shareCount: number): Promise<void> {
    await db.query(
      `INSERT INTO equal_splits (bill_id, tenant_id, share_count) VALUES ($1, $2, $3)
       ON CONFLICT (bill_id) DO UPDATE SET share_count = EXCLUDED.share_count, updated_at = now()`,
      [billId, tenantId, shareCount],
    );
  }

  async delete(db: Queryable, billId: string): Promise<void> {
    await db.query(`DELETE FROM equal_splits WHERE bill_id = $1`, [billId]);
  }

  /** Fixes share amounts: from now on each share is a fixed part of `baseAmountMinor`. */
  async freeze(db: Queryable, billId: string, baseAmountMinor: number): Promise<void> {
    await db.query(
      `UPDATE equal_splits SET base_amount_minor = $2, frozen_at = now(), updated_at = now()
       WHERE bill_id = $1 AND frozen_at IS NULL`,
      [billId, baseAmountMinor],
    );
  }
}

function mapSplit(row: Record<string, unknown>): EqualSplitRecord {
  return {
    billId: row.bill_id as string,
    tenantId: row.tenant_id as string,
    shareCount: Number(row.share_count),
    baseAmountMinor: row.base_amount_minor === null ? null : Number(row.base_amount_minor),
    frozenAt: (row.frozen_at as Date | null) ?? null,
  };
}
