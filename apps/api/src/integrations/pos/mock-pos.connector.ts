import { Injectable } from "@nestjs/common";
import { Bill, BillStatus } from "@tabtap/shared";
import {
  MarkPaidInput,
  POSConnector,
  POSConnectorCapabilities,
} from "./pos-connector.interface";

// In-memory POS with a couple of seeded demo bills, keyed by table id.
// Lets the guest app and QA exercise the full flow before any real POS is connected.
@Injectable()
export class MockPOSConnector implements POSConnector {
  readonly type = "mock";
  readonly capabilities: POSConnectorCapabilities = {
    supportsWebhooks: false,
    supportsMarkPaid: true,
    supportsPartialPayment: true,
  };

  private readonly bills = new Map<string, Bill>([
    [
      "table-1",
      {
        id: "bill-1",
        tenantId: "demo-tenant",
        venueId: "demo-venue",
        tableId: "table-1",
        externalPosId: "mock-pos-bill-1",
        currency: "EUR",
        items: [
          { id: "item-1", name: "Margherita Pizza", quantity: 1, unitPriceMinor: 1200, taxMinor: 120, discountMinor: 0 },
          { id: "item-2", name: "Caesar Salad", quantity: 1, unitPriceMinor: 900, taxMinor: 90, discountMinor: 0 },
          { id: "item-3", name: "Sparkling Water", quantity: 2, unitPriceMinor: 350, taxMinor: 70, discountMinor: 0 },
        ],
        totalMinor: 1200 + 900 + 700 + 280,
        paidMinor: 0,
        status: BillStatus.OPEN,
        lastSyncedAt: new Date().toISOString(),
      },
    ],
  ]);

  async getOpenBill(tableExternalRef: string): Promise<Bill | null> {
    const bill = this.bills.get(tableExternalRef);
    return bill ? { ...bill } : null;
  }

  async getBillDetails(billExternalRef: string): Promise<Bill> {
    const bill = [...this.bills.values()].find((b) => b.id === billExternalRef);
    if (!bill) {
      throw new Error(`Bill ${billExternalRef} not found`);
    }
    return { ...bill };
  }

  async markPaid(billExternalRef: string, payment: MarkPaidInput): Promise<void> {
    const bill = [...this.bills.values()].find((b) => b.id === billExternalRef);
    if (!bill) {
      throw new Error(`Bill ${billExternalRef} not found`);
    }
    bill.paidMinor = Math.min(bill.totalMinor, bill.paidMinor + payment.amountMinor);
    bill.status = bill.paidMinor >= bill.totalMinor ? BillStatus.PAID : BillStatus.PARTIALLY_PAID;
    bill.lastSyncedAt = new Date().toISOString();
    this.bills.set(bill.tableId, bill);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
