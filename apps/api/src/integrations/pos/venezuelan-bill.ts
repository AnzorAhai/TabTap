import { percentOf, type BillItem } from "@tabtap/shared";
import type { PosBill } from "./pos-connector.interface";

const IVA_PERCENT = 16; // Venezuela's general VAT rate
const SERVICE_PERCENT = 10; // customary restaurant service charge

/** A Venezuelan-style open bill: IVA per line and 10% service on the subtotal. */
export function venezuelanBill(
  externalId: string,
  currency: string,
  lines: Pick<BillItem, "id" | "name" | "quantity" | "unitPriceMinor">[],
): PosBill {
  const items: BillItem[] = lines.map((line) => ({
    ...line,
    taxMinor: percentOf(line.unitPriceMinor * line.quantity, IVA_PERCENT),
    discountMinor: 0,
  }));
  const subtotal = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
  const tax = items.reduce((sum, item) => sum + item.taxMinor, 0);
  const serviceChargeMinor = percentOf(subtotal, SERVICE_PERCENT);
  return {
    externalId,
    currency,
    items,
    serviceChargeMinor,
    totalMinor: subtotal + tax + serviceChargeMinor,
    status: "open",
  };
}
