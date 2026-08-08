import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { Split, SplitType } from "@tabtap/shared";
import { DB_POOL } from "../database/database.module";

@Injectable()
export class SplitsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async createEqualSplit(
    tenantId: string,
    billId: string,
    remainingMinor: number,
    participantsCount: number,
  ): Promise<Split> {
    const base = Math.floor(remainingMinor / participantsCount);
    const remainder = remainingMinor - base * participantsCount;

    const client = await this.pool.connect();
    let splitId: string;
    try {
      await client.query("BEGIN");
      const splitResult = await client.query(
        `INSERT INTO splits (tenant_id, bill_id, type) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, billId, SplitType.EQUAL],
      );
      splitId = splitResult.rows[0].id;

      for (let i = 0; i < participantsCount; i++) {
        // first `remainder` participants absorb the extra minor unit so the split sums exactly.
        const amountDueMinor = base + (i < remainder ? 1 : 0);
        await client.query(
          `INSERT INTO split_participants (tenant_id, split_id, label, amount_due_minor) VALUES ($1, $2, $3, $4)`,
          [tenantId, splitId, `Guest ${i + 1}`, amountDueMinor],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return this.findById(splitId);
  }

  async findById(splitId: string): Promise<Split> {
    const splitRes = await this.pool.query(`SELECT * FROM splits WHERE id = $1`, [splitId]);
    if (splitRes.rows.length === 0) {
      throw new NotFoundException(`Split ${splitId} not found`);
    }
    const participantsRes = await this.pool.query(
      `SELECT * FROM split_participants WHERE split_id = $1 ORDER BY label`,
      [splitId],
    );
    const row = splitRes.rows[0];
    return {
      id: row.id,
      billId: row.bill_id,
      type: row.type,
      createdAt: row.created_at.toISOString(),
      participants: participantsRes.rows.map((p) => ({
        id: p.id,
        splitId: p.split_id,
        label: p.label,
        amountDueMinor: Number(p.amount_due_minor),
        amountPaidMinor: Number(p.amount_paid_minor),
      })),
    };
  }

  async addParticipantPayment(splitId: string, participantId: string, amountMinor: number): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE split_participants SET amount_paid_minor = amount_paid_minor + $1 WHERE id = $2 AND split_id = $3`,
      [amountMinor, participantId, splitId],
    );
    if (rowCount === 0) {
      throw new NotFoundException(`Participant ${participantId} not found in split ${splitId}`);
    }
  }
}
