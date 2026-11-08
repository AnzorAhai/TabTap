import type { DemoPosRepository } from "../../data/demo-pos.repository";
import type { MarkPaidInput, POSConnector, PosBill, PosTableRef } from "./pos-connector.interface";
import { venezuelanBill } from "./venezuelan-bill";

/**
 * The POS for investor demos, kept in TabTap's own database: waiters punch orders on
 * the demo POS screen and guests see them like a bill from a real POS.
 */
export class DemoPOSConnector implements POSConnector {
  readonly type = "demo";

  constructor(private readonly orders: DemoPosRepository) {}

  async getOpenBill(table: PosTableRef): Promise<PosBill | null> {
    const order = await this.orders.findOpenByPosRef(table.venueId, table.posTableRef);
    if (!order || order.lines.length === 0) return null;
    return venezuelanBill(
      order.id,
      order.currency,
      order.lines.map((line) => ({ id: line.id, name: line.name, quantity: 1, unitPriceMinor: line.priceMinor })),
    );
  }

  /** Nothing to deliver: the demo POS screen reads payments straight from TabTap's tables. */
  async markPaid(_externalBillId: string, _payment: MarkPaidInput): Promise<void> {}

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
