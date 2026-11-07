import { Inject, Injectable } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";

export interface PosSyncJob {
  id: string;
  paymentId: string;
  attempts: number;
  externalPosId: string;
  posStatus: string;
  amountMinor: number;
  tipMinor: number;
  currency: string;
}

@Injectable()
export class PosSyncRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** Queues "tell the POS this payment happened"; written in the settling transaction. */
  async enqueueMarkPaid(db: Queryable, tenantId: string, billId: string, paymentId: string): Promise<void> {
    await db.query(
      `INSERT INTO pos_sync_jobs (tenant_id, bill_id, payment_id, kind) VALUES ($1, $2, $3, 'mark_paid')
       ON CONFLICT (payment_id) DO NOTHING`,
      [tenantId, billId, paymentId],
    );
  }

  /**
   * Claims up to `limit` due jobs for this transaction. SKIP LOCKED lets several API
   * instances work the queue without picking the same job.
   */
  async claimDue(client: PoolClient, limit: number): Promise<PosSyncJob[]> {
    const { rows } = await client.query(
      `SELECT j.id, j.payment_id, j.attempts, b.external_pos_id, b.pos_status,
              p.amount_minor, p.tip_minor, p.currency
       FROM pos_sync_jobs j
       JOIN payments p ON p.id = j.payment_id
       JOIN bills b ON b.id = j.bill_id
       WHERE j.status = 'pending' AND j.next_attempt_at <= now()
       ORDER BY j.next_attempt_at
       LIMIT $1
       FOR UPDATE OF j SKIP LOCKED`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      paymentId: row.payment_id,
      attempts: Number(row.attempts),
      externalPosId: row.external_pos_id,
      posStatus: row.pos_status,
      amountMinor: Number(row.amount_minor),
      tipMinor: Number(row.tip_minor),
      currency: row.currency,
    }));
  }

  async markDone(client: PoolClient, jobId: string): Promise<void> {
    await client.query(
      `UPDATE pos_sync_jobs SET status = 'done', attempts = attempts + 1, last_error = NULL, updated_at = now()
       WHERE id = $1`,
      [jobId],
    );
  }

  async markRetry(client: PoolClient, jobId: string, error: string, retryInSeconds: number, giveUp: boolean) {
    await client.query(
      `UPDATE pos_sync_jobs SET
         status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
         attempts = attempts + 1,
         last_error = $2,
         next_attempt_at = now() + make_interval(secs => $3),
         updated_at = now()
       WHERE id = $1`,
      [jobId, error.slice(0, 1000), retryInSeconds, giveUp],
    );
  }
}
