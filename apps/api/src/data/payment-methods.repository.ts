import { Inject, Injectable } from "@nestjs/common";
import type { PaymentMethod, TenantPaymentMethodView } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import { withTransaction, type Queryable } from "../database/transaction";

/** Which payment methods each restaurant accepts, and where guests send the money. */
@Injectable()
export class PaymentMethodsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async list(tenantId: string, db: Queryable = this.pool): Promise<TenantPaymentMethodView[]> {
    const { rows } = await db.query(
      `SELECT * FROM tenant_payment_methods WHERE tenant_id = $1 ORDER BY sort_order, method`,
      [tenantId],
    );
    return rows.map((r) => ({
      method: r.method as PaymentMethod,
      enabled: r.enabled as boolean,
      surchargeBps: Number(r.surcharge_bps),
      details: r.details as Record<string, string>,
      sortOrder: Number(r.sort_order),
    }));
  }

  async find(tenantId: string, method: PaymentMethod, db: Queryable = this.pool) {
    return (await this.list(tenantId, db)).find((m) => m.method === method) ?? null;
  }

  /** Replaces the restaurant's whole configuration. */
  async replace(tenantId: string, methods: TenantPaymentMethodView[]): Promise<void> {
    await withTransaction(this.pool, async (db) => {
      await db.query(`DELETE FROM tenant_payment_methods WHERE tenant_id = $1`, [tenantId]);
      for (const m of methods) {
        await this.insert(db, tenantId, m);
      }
    });
  }

  async insert(db: Queryable, tenantId: string, m: TenantPaymentMethodView): Promise<void> {
    await db.query(
      `INSERT INTO tenant_payment_methods (tenant_id, method, enabled, surcharge_bps, details, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, m.method, m.enabled, m.surchargeBps, JSON.stringify(m.details), m.sortOrder],
    );
  }
}
