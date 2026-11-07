import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { lineTotalsMinor, type BillItem, type PaymentMode, type ReceiptView } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import { normalizeDecimal } from "./records";

@Injectable()
export class ReceiptsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async createForPayment(db: Queryable, tenantId: string, paymentId: string): Promise<void> {
    await db.query(`INSERT INTO receipts (tenant_id, payment_id) VALUES ($1, $2) ON CONFLICT (payment_id) DO NOTHING`, [
      tenantId,
      paymentId,
    ]);
  }

  // Not a fiscal document — a confirmation of what the guest paid for.
  async getViewByPaymentId(paymentId: string): Promise<ReceiptView> {
    const { rows } = await this.pool.query(
      `SELECT r.id AS receipt_id, p.id AS payment_id, p.mode, p.item_ids, p.share_indices,
              p.amount_minor, p.tip_minor, p.currency, p.charge_amount_minor, p.charge_currency,
              p.exchange_rate, p.settled_at,
              b.items AS bill_items, b.total_minor AS bill_total_minor,
              tn.name AS tenant_name, v.name AS venue_name, t.label AS table_label
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN bills b ON b.id = p.bill_id
       JOIN tables t ON t.id = b.table_id
       JOIN venues v ON v.id = b.venue_id
       JOIN tenants tn ON tn.id = p.tenant_id
       WHERE r.payment_id = $1`,
      [paymentId],
    );
    if (rows.length === 0) throw new NotFoundException(`Receipt for payment ${paymentId} not found`);
    const row = rows[0];

    let items: ReceiptView["items"] = null;
    if (row.item_ids) {
      const billItems = row.bill_items as BillItem[];
      const totals = lineTotalsMinor(billItems, Number(row.bill_total_minor));
      const paid = new Set(row.item_ids as string[]);
      items = billItems
        .map((item, i) => ({ name: item.name, quantity: item.quantity, lineTotalMinor: totals[i], id: item.id }))
        .filter((item) => paid.has(item.id))
        .map(({ name, quantity, lineTotalMinor }) => ({ name, quantity, lineTotalMinor }));
    }

    return {
      receiptId: row.receipt_id,
      paymentId: row.payment_id,
      tenantName: row.tenant_name,
      venueName: row.venue_name,
      tableLabel: row.table_label,
      mode: row.mode as PaymentMode,
      items,
      shareCount: row.share_indices ? (row.share_indices as number[]).length : null,
      amountMinor: Number(row.amount_minor),
      tipMinor: Number(row.tip_minor),
      currency: row.currency,
      chargeAmountMinor: Number(row.charge_amount_minor),
      chargeCurrency: row.charge_currency,
      exchangeRate: row.exchange_rate === null ? null : normalizeDecimal(row.exchange_rate as string),
      paidAt: (row.settled_at as Date).toISOString(),
    };
  }
}
