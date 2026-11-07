import { Logger } from "@nestjs/common";
import { percentOf, type BillItem } from "@tabtap/shared";
import type { MarkPaidInput, POSConnector, PosBill } from "./pos-connector.interface";

const IVA_PERCENT = 16; // Venezuela's general VAT rate
const SERVICE_PERCENT = 10; // customary restaurant service charge

/** A Venezuelan-style bill: prices in USD, IVA per line, 10% service on the subtotal. */
function demoBill(externalId: string, lines: [id: string, name: string, quantity: number, unitPriceCents: number][]) {
  const items: BillItem[] = lines.map(([id, name, quantity, unitPriceMinor]) => ({
    id,
    name,
    quantity,
    unitPriceMinor,
    taxMinor: percentOf(unitPriceMinor * quantity, IVA_PERCENT),
    discountMinor: 0,
  }));
  const subtotal = items.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0);
  const tax = items.reduce((s, i) => s + i.taxMinor, 0);
  const serviceChargeMinor = percentOf(subtotal, SERVICE_PERCENT);
  const bill: PosBill = {
    externalId,
    currency: "USD",
    items,
    serviceChargeMinor,
    totalMinor: subtotal + tax + serviceChargeMinor,
    status: "open",
  };
  return bill;
}

/**
 * In-memory POS with three seeded demo bills, keyed by the POS table reference.
 * Lets the guest app and QA exercise the whole flow before any real POS is connected.
 * State resets when the API restarts.
 */
export class MockPOSConnector implements POSConnector {
  readonly type = "mock";
  private readonly logger = new Logger(MockPOSConnector.name);

  private readonly bills = new Map<string, PosBill>([
    [
      "table-1",
      demoBill("demo-ve-bill-1", [
        ["t1-arepa", "Arepa reina pepiada", 2, 650],
        ["t1-cachapa", "Cachapa con queso de mano", 1, 800],
        ["t1-tequenos", "Tequeños (6 u.)", 1, 550],
        ["t1-papelon", "Papelón con limón", 3, 250],
      ]),
    ],
    [
      "table-2",
      demoBill("demo-ve-bill-2", [
        ["t2-pabellon", "Pabellón criollo", 2, 1200],
        ["t2-asado", "Asado negro", 1, 1450],
        ["t2-ensalada", "Ensalada de aguacate", 1, 600],
        ["t2-polar", "Cerveza Polar", 4, 200],
        ["t2-quesillo", "Quesillo", 2, 400],
      ]),
    ],
    [
      "table-3",
      demoBill("demo-ve-bill-3", [
        ["t3-parrilla", "Parrilla mixta para dos", 1, 3200],
        ["t3-hallaca", "Hallaca", 2, 700],
        ["t3-malta", "Malta", 2, 180],
        ["t3-parchita", "Jugo de parchita", 2, 300],
        ["t3-tresleches", "Torta tres leches", 1, 500],
      ]),
    ],
  ]);

  /** Payments the POS has been told about, by payment id (marking the same payment twice is a no-op). */
  readonly markedPayments = new Map<string, MarkPaidInput & { externalBillId: string }>();

  async getOpenBill(posTableRef: string): Promise<PosBill | null> {
    const bill = this.bills.get(posTableRef);
    return bill && bill.status === "open" ? structuredClone(bill) : null;
  }

  async markPaid(externalBillId: string, payment: MarkPaidInput): Promise<void> {
    if (![...this.bills.values()].some((b) => b.externalId === externalBillId)) {
      throw new Error(`Bill ${externalBillId} not found on the mock POS`);
    }
    if (this.markedPayments.has(payment.paymentId)) return;
    this.markedPayments.set(payment.paymentId, { ...payment, externalBillId });
    this.logger.log(
      `Bill ${externalBillId}: payment ${payment.paymentId} of ${payment.amountMinor} ${payment.currency}`,
    );
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
