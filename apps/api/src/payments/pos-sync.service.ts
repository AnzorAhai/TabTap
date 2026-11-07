import { Inject, Injectable, Logger } from "@nestjs/common";
import { Pool } from "pg";
import { PosSyncRepository } from "../data/pos-sync.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction } from "../database/transaction";
import { POS_CONNECTOR, type POSConnector } from "../integrations/pos/pos-connector.interface";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 20;

/** Retry delay after the n-th failed attempt: 5s, 10s, 20s, … capped at 10 minutes. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(5 * 2 ** (attempt - 1), 600);
}

/**
 * Delivers queued "payment made" notices to the POS. The queue is written in the
 * same transaction as the payment, so a POS outage delays the notice but never loses it.
 */
@Injectable()
export class PosSyncService {
  private readonly logger = new Logger(PosSyncService.name);

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(POS_CONNECTOR) private readonly pos: POSConnector,
    private readonly jobs: PosSyncRepository,
  ) {}

  /** Processes one batch of due jobs; returns how many were delivered. */
  async processDue(): Promise<number> {
    return withTransaction(this.pool, async (db) => {
      const due = await this.jobs.claimDue(db, BATCH_SIZE);
      let delivered = 0;
      for (const job of due) {
        try {
          await this.pos.markPaid(job.externalPosId, {
            paymentId: job.paymentId,
            amountMinor: job.amountMinor,
            tipMinor: job.tipMinor,
            currency: job.currency,
          });
          await this.jobs.markDone(db, job.id);
          delivered += 1;
        } catch (err) {
          const attempt = job.attempts + 1;
          const message = err instanceof Error ? err.message : String(err);
          const giveUp = attempt >= MAX_ATTEMPTS;
          await this.jobs.markRetry(db, job.id, message, retryDelaySeconds(attempt), giveUp);
          const log = `POS update for payment ${job.paymentId} failed (attempt ${attempt}): ${message}`;
          if (giveUp) this.logger.error(`${log} — giving up`);
          else this.logger.warn(log);
        }
      }
      return delivered;
    });
  }
}
