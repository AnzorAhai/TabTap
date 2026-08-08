import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
        itemIds: p.item_ids ?? undefined,
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

  // One shared by_items split per bill — every guest who pays for specific dishes
  // becomes another participant on it, so everyone sees which items are already claimed.
  async findByItemsSplitForBill(billId: string): Promise<Split | null> {
    const { rows } = await this.pool.query(
      `SELECT id FROM splits WHERE bill_id = $1 AND type = $2 LIMIT 1`,
      [billId, SplitType.BY_ITEMS],
    );
    if (rows.length === 0) {
      return null;
    }
    return this.findById(rows[0].id);
  }

  async addItemsParticipant(
    tenantId: string,
    billId: string,
    itemIds: string[],
    amountDueMinor: number,
  ): Promise<{ split: Split; participantId: string }> {
    const client = await this.pool.connect();
    let splitId: string;
    let participantId: string;
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id FROM splits WHERE bill_id = $1 AND type = $2 FOR UPDATE`,
        [billId, SplitType.BY_ITEMS],
      );
      if (existing.rows.length > 0) {
        splitId = existing.rows[0].id;
      } else {
        const created = await client.query(
          `INSERT INTO splits (tenant_id, bill_id, type) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, billId, SplitType.BY_ITEMS],
        );
        splitId = created.rows[0].id;
      }

      const claimed = await client.query(
        `SELECT item_ids FROM split_participants WHERE split_id = $1 AND item_ids IS NOT NULL`,
        [splitId],
      );
      const alreadyClaimed = new Set<string>(claimed.rows.flatMap((r) => r.item_ids as string[]));
      const conflict = itemIds.find((id) => alreadyClaimed.has(id));
      if (conflict) {
        throw new ConflictException(`Item ${conflict} is already being paid for by someone else`);
      }

      const guestNumber = claimed.rows.length + 1;
      const inserted = await client.query(
        `INSERT INTO split_participants (tenant_id, split_id, label, amount_due_minor, item_ids)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, splitId, `Guest ${guestNumber}`, amountDueMinor, JSON.stringify(itemIds)],
      );
      participantId = inserted.rows[0].id;

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return { split: await this.findById(splitId), participantId };
  }
}
