import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminPaymentView, FeeReportRow, PaymentMethod, PaymentMode, PaymentStatus } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import { normalizeDecimal, type PaymentRecord } from "./records";

export type NewPayment = Omit<
  PaymentRecord,
  "id" | "createdAt" | "settledAt" | "failureReason" | "providerRef" | "proof" | "proofSubmittedAt" | "reviewedBy"
>;

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async insert(db: Queryable, p: NewPayment): Promise<PaymentRecord> {
    const { rows } = await db.query(
      `INSERT INTO payments (tenant_id, bill_id, mode, status, item_ids, share_indices, amount_minor, tip_minor,
                             platform_fee_minor, currency, charge_currency, charge_amount_minor, exchange_rate,
                             provider, idempotency_key, expires_at, method, surcharge_bps, surcharge_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        p.tenantId,
        p.billId,
        p.mode,
        p.status,
        p.itemIds ? JSON.stringify(p.itemIds) : null,
        p.shareIndices,
        p.amountMinor,
        p.tipMinor,
        p.platformFeeMinor,
        p.currency,
        p.chargeCurrency,
        p.chargeAmountMinor,
        p.exchangeRate,
        p.provider,
        p.idempotencyKey,
        p.expiresAt,
        p.method,
        p.surchargeBps,
        p.surchargeMinor,
      ],
    );
    return mapPayment(rows[0]);
  }

  async findById(paymentId: string, db: Queryable = this.pool): Promise<PaymentRecord> {
    const { rows } = await db.query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
    if (rows.length === 0) throw new NotFoundException(`Payment ${paymentId} not found`);
    return mapPayment(rows[0]);
  }

  async lockById(db: Queryable, paymentId: string): Promise<PaymentRecord> {
    const { rows } = await db.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);
    if (rows.length === 0) throw new NotFoundException(`Payment ${paymentId} not found`);
    return mapPayment(rows[0]);
  }

  async findByIdempotencyKey(db: Queryable, billId: string, key: string): Promise<PaymentRecord | null> {
    const { rows } = await db.query(`SELECT * FROM payments WHERE bill_id = $1 AND idempotency_key = $2`, [
      billId,
      key,
    ]);
    return rows.length ? mapPayment(rows[0]) : null;
  }

  async findByProviderRef(provider: string, providerRef: string): Promise<PaymentRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2`, [
      provider,
      providerRef,
    ]);
    return rows.length ? mapPayment(rows[0]) : null;
  }

  /** Payments that count towards the bill: settled ones, and pending ones (which hold what they cover). */
  async listLiveForBill(billId: string, db: Queryable = this.pool): Promise<PaymentRecord[]> {
    const { rows } = await db.query(
      `SELECT * FROM payments WHERE bill_id = $1 AND status IN ('pending', 'succeeded') ORDER BY created_at`,
      [billId],
    );
    return rows.map(mapPayment);
  }

  async setProviderRef(paymentId: string, providerRef: string): Promise<void> {
    await this.pool.query(`UPDATE payments SET provider_ref = $2, updated_at = now() WHERE id = $1`, [
      paymentId,
      providerRef,
    ]);
  }

  async markSucceeded(db: Queryable, paymentId: string): Promise<PaymentRecord> {
    const { rows } = await db.query(
      `UPDATE payments SET status = 'succeeded', settled_at = now(), failure_reason = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [paymentId],
    );
    return mapPayment(rows[0]);
  }

  /** Stores what the guest reported for a pending proof-based payment; null if no longer pending. */
  async submitProof(paymentId: string, proof: Record<string, string>): Promise<PaymentRecord | null> {
    const { rows } = await this.pool.query(
      `UPDATE payments SET proof = $2, proof_submitted_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [paymentId, JSON.stringify(proof)],
    );
    return rows.length ? mapPayment(rows[0]) : null;
  }

  async setReviewedBy(db: Queryable, paymentId: string, userId: string): Promise<void> {
    await db.query(`UPDATE payments SET reviewed_by = $2 WHERE id = $1`, [paymentId, userId]);
  }

  /**
   * Pending proof-based payments of methods set to "simulated" verification whose proof
   * was submitted at least `afterSeconds` ago — the demo stand-in for a bank check.
   */
  async listDueForSimulatedCheck(afterSeconds: number): Promise<PaymentRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT p.* FROM payments p
       JOIN tenant_payment_methods m ON m.tenant_id = p.tenant_id AND m.method = p.method
       WHERE p.status = 'pending' AND p.proof_submitted_at <= now() - make_interval(secs => $1)
         AND m.details->>'verification' = 'simulated'
       ORDER BY p.proof_submitted_at
       LIMIT 50`,
      [afterSeconds],
    );
    return rows.map(mapPayment);
  }

  /** Moves a still-pending payment to a final status; returns null if it was no longer pending. */
  async finishPending(
    paymentId: string,
    status: Extract<PaymentStatus, "failed" | "canceled" | "expired">,
    reason: string,
  ): Promise<PaymentRecord | null> {
    const { rows } = await this.pool.query(
      `UPDATE payments SET status = $2, failure_reason = $3, updated_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [paymentId, status, reason],
    );
    return rows.length ? mapPayment(rows[0]) : null;
  }

  /** Expires every pending payment whose hold ended at or before `now`. */
  async expireDue(now: Date): Promise<PaymentRecord[]> {
    const { rows } = await this.pool.query(
      `UPDATE payments SET status = 'expired', failure_reason = 'hold_expired', updated_at = now()
       WHERE status = 'pending' AND expires_at <= $1 RETURNING *`,
      [now],
    );
    return rows.map(mapPayment);
  }

  /** Settled payments' bill amounts and platform fees in [from, to), per restaurant and currency. */
  async feeReport(from: Date, to: Date, tenantId?: string): Promise<FeeReportRow[]> {
    const { rows } = await this.pool.query(
      `SELECT p.tenant_id, t.name AS tenant_name, p.currency, count(*)::int AS payments,
              sum(p.amount_minor) AS bill_amount, sum(p.platform_fee_minor) AS fee
       FROM payments p JOIN tenants t ON t.id = p.tenant_id
       WHERE p.status = 'succeeded' AND p.settled_at >= $1 AND p.settled_at < $2
         AND ($3::uuid IS NULL OR p.tenant_id = $3)
       GROUP BY p.tenant_id, t.name, p.currency
       ORDER BY t.name, p.currency`,
      [from, to, tenantId ?? null],
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      currency: r.currency,
      payments: r.payments,
      billAmountMinor: Number(r.bill_amount),
      feeMinor: Number(r.fee),
    }));
  }

  async listByTenant(tenantId: string, limit = 100): Promise<AdminPaymentView[]> {
    const { rows } = await this.pool.query(
      `SELECT p.*, t.label AS table_label
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       JOIN tables t ON t.id = b.table_id
       WHERE p.tenant_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      billId: row.bill_id,
      tableLabel: row.table_label,
      mode: row.mode as PaymentMode,
      amountMinor: Number(row.amount_minor),
      tipMinor: Number(row.tip_minor),
      platformFeeMinor: Number(row.platform_fee_minor),
      currency: row.currency,
      chargeAmountMinor: Number(row.charge_amount_minor),
      chargeCurrency: row.charge_currency,
      surchargeMinor: Number(row.surcharge_minor),
      method: row.method as PaymentMethod,
      status: row.status as PaymentStatus,
      proof: (row.proof as Record<string, string> | null) ?? null,
      awaitingReview: row.status === "pending" && row.method !== "card",
      createdAt: (row.created_at as Date).toISOString(),
    }));
  }
}

function mapPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    billId: row.bill_id as string,
    mode: row.mode as PaymentMode,
    status: row.status as PaymentStatus,
    itemIds: (row.item_ids as string[] | null) ?? null,
    shareIndices: (row.share_indices as number[] | null) ?? null,
    amountMinor: Number(row.amount_minor),
    tipMinor: Number(row.tip_minor),
    platformFeeMinor: Number(row.platform_fee_minor),
    currency: row.currency as string,
    chargeCurrency: row.charge_currency as string,
    chargeAmountMinor: Number(row.charge_amount_minor),
    exchangeRate: row.exchange_rate === null ? null : normalizeDecimal(row.exchange_rate as string),
    method: row.method as PaymentMethod,
    surchargeBps: Number(row.surcharge_bps),
    surchargeMinor: Number(row.surcharge_minor),
    proof: (row.proof as Record<string, string> | null) ?? null,
    proofSubmittedAt: (row.proof_submitted_at as Date | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    provider: row.provider as string,
    providerRef: (row.provider_ref as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    expiresAt: (row.expires_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    settledAt: (row.settled_at as Date | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
  };
}
