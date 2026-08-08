import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { AdminPaymentView, Payment, PaymentStatus } from "@tabtap/shared";
import { DB_POOL } from "../database/database.module";

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async create(payment: Omit<Payment, "createdAt">): Promise<Payment> {
    const { rows } = await this.pool.query(
      `INSERT INTO payments (id, tenant_id, bill_id, split_participant_id, amount_minor, currency, tip_minor, platform_fee_minor, status, provider_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING created_at`,
      [
        payment.id,
        payment.tenantId,
        payment.billId,
        payment.splitParticipantId ?? null,
        payment.amountMinor,
        payment.currency,
        payment.tipMinor,
        payment.platformFeeMinor,
        payment.status,
        payment.providerRef ?? null,
      ],
    );
    return { ...payment, createdAt: rows[0].created_at.toISOString() };
  }

  async findById(paymentId: string): Promise<Payment> {
    const { rows } = await this.pool.query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      billId: row.bill_id,
      splitParticipantId: row.split_participant_id ?? undefined,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      tipMinor: Number(row.tip_minor),
      platformFeeMinor: Number(row.platform_fee_minor),
      status: row.status as PaymentStatus,
      providerRef: row.provider_ref ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listByTenant(tenantId: string, limit = 50): Promise<AdminPaymentView[]> {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.bill_id, p.amount_minor, p.tip_minor, p.currency, p.status, p.created_at,
              t.label AS table_label, sp.label AS participant_label
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       JOIN tables t ON t.id = b.table_id
       LEFT JOIN split_participants sp ON sp.id = p.split_participant_id
       WHERE p.tenant_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      billId: row.bill_id,
      tableLabel: row.table_label,
      participantLabel: row.participant_label ?? undefined,
      amountMinor: Number(row.amount_minor),
      tipMinor: Number(row.tip_minor),
      currency: row.currency,
      status: row.status as PaymentStatus,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
