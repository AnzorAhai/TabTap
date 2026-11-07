import { allocateProportionally } from "./money.js";

/** A bill line as the POS reports it. Amounts are in the bill currency's minor unit. */
export interface BillItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  /** Tax for the whole line (all units). */
  taxMinor: number;
  /** Discount for the whole line (all units). */
  discountMinor: number;
}

/** Line amount before bill-level charges: price × quantity − discount + tax. */
export function lineBaseMinor(item: BillItem): number {
  return item.unitPriceMinor * item.quantity - item.discountMinor + item.taxMinor;
}

/**
 * What each line costs a guest who pays for it, so that all lines add up to exactly
 * the bill total. Everything the POS adds on top of the lines (service charge,
 * bill-level rounding or discounts) is spread across the lines in proportion to
 * their amount.
 */
export function lineTotalsMinor(items: readonly BillItem[], billTotalMinor: number): number[] {
  const bases = items.map(lineBaseMinor);
  const extra = billTotalMinor - bases.reduce((a, b) => a + b, 0);
  const allocated = allocateProportionally(
    extra,
    bases.map((b) => Math.max(b, 0)),
  );
  return bases.map((base, i) => base + allocated[i]);
}

export interface BillBreakdown {
  /** Σ price × quantity − discount. */
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  totalMinor: number;
}

export function billBreakdown(
  items: readonly BillItem[],
  serviceChargeMinor: number,
  totalMinor: number,
): BillBreakdown {
  return {
    subtotalMinor: items.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity - i.discountMinor, 0),
    taxMinor: items.reduce((sum, i) => sum + i.taxMinor, 0),
    serviceChargeMinor,
    totalMinor,
  };
}
