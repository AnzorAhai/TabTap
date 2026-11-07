import { Injectable } from "@nestjs/common";
import { Bill, BillStatus } from "@tabtap/shared";
import { MarkPaidInput, POSConnector, POSConnectorCapabilities } from "./pos-connector.interface";

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
          {
            id: "item-1",
            name: "Margherita Pizza",
            quantity: 1,
            unitPriceMinor: 1200,
            taxMinor: 120,
            discountMinor: 0,
          },
          { id: "item-2", name: "Caesar Salad", quantity: 1, unitPriceMinor: 900, taxMinor: 90, discountMinor: 0 },
          { id: "item-3", name: "Sparkling Water", quantity: 2, unitPriceMinor: 350, taxMinor: 70, discountMinor: 0 },
        ],
        totalMinor: 1200 + 900 + 700 + 280,
        paidMinor: 0,
        status: BillStatus.OPEN,
        lastSyncedAt: new Date().toISOString(),
      },
    ],
    [
      "table-2",
      {
        id: "bill-2",
        tenantId: "demo-tenant",
        venueId: "demo-venue",
        tableId: "table-2",
        externalPosId: "mock-pos-bill-2",
        currency: "EUR",
        items: [
          {
            id: "item-4",
            name: "Ribeye Steak 300g",
            quantity: 2,
            unitPriceMinor: 2900,
            taxMinor: 290,
            discountMinor: 0,
          },
          { id: "item-5", name: "Truffle Fries", quantity: 1, unitPriceMinor: 700, taxMinor: 70, discountMinor: 0 },
          {
            id: "item-6",
            name: "House Red Wine, glass",
            quantity: 2,
            unitPriceMinor: 600,
            taxMinor: 60,
            discountMinor: 0,
          },
        ],
        totalMinor: 2 * 2900 + 700 + 2 * 600 + 290 * 2 + 70 + 60 * 2,
        paidMinor: 0,
        status: BillStatus.OPEN,
        lastSyncedAt: new Date().toISOString(),
      },
    ],
    [
      "table-3",
      {
        id: "bill-3",
        tenantId: "demo-tenant",
        venueId: "demo-venue",
        tableId: "table-3",
        externalPosId: "mock-pos-bill-3",
        currency: "EUR",
        items: [
          { id: "item-7", name: "Beef Burger", quantity: 3, unitPriceMinor: 1400, taxMinor: 140, discountMinor: 0 },
          { id: "item-8", name: "Onion Rings", quantity: 1, unitPriceMinor: 550, taxMinor: 55, discountMinor: 0 },
          { id: "item-9", name: "Craft Cola", quantity: 3, unitPriceMinor: 400, taxMinor: 40, discountMinor: 0 },
        ],
        totalMinor: 3 * 1400 + 550 + 3 * 400 + 140 * 3 + 55 + 40 * 3,
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
    const bill = [...this.bills.values()].find((b) => b.externalPosId === billExternalRef);
    if (!bill) {
      throw new Error(`Bill ${billExternalRef} not found`);
    }
    return { ...bill };
  }

  async markPaid(billExternalRef: string, payment: MarkPaidInput): Promise<void> {
    const bill = [...this.bills.values()].find((b) => b.externalPosId === billExternalRef);
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
