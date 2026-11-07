import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { ReceiptView } from "@tabtap/shared";
import { DB_POOL } from "../database/database.module";

@Injectable()
export class ReceiptsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async createForPayment(paymentId: string, tenantId: string): Promise<void> {
    await this.pool.query(`INSERT INTO receipts (tenant_id, payment_id) VALUES ($1, $2)`, [tenantId, paymentId]);
  }

  // Not a fiscal document — just enough to show the guest what they paid for.
  async getViewByPaymentId(paymentId: string): Promise<ReceiptView> {
    const { rows } = await this.pool.query(
      `SELECT
         r.id AS receipt_id,
         p.id AS payment_id,
         p.amount_minor,
         p.tip_minor,
         p.currency,
         p.created_at AS paid_at,
         t.name AS tenant_name,
         v.name AS venue_name,
         sp.label AS participant_label
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN bills b ON b.id = p.bill_id
       JOIN tenants t ON t.id = p.tenant_id
       JOIN venues v ON v.id = b.venue_id
       LEFT JOIN split_participants sp ON sp.id = p.split_participant_id
       WHERE r.payment_id = $1`,
      [paymentId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Receipt for payment ${paymentId} not found`);
    }
    const row = rows[0];
    return {
      receiptId: row.receipt_id,
      paymentId: row.payment_id,
      tenantName: row.tenant_name,
      venueName: row.venue_name,
      participantLabel: row.participant_label ?? undefined,
      amountMinor: Number(row.amount_minor),
      tipMinor: Number(row.tip_minor),
      currency: row.currency,
      paidAt: row.paid_at.toISOString(),
    };
  }
}
