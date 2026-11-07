import { describe, expect, it } from "vitest";
import { billBreakdown, lineTotalsMinor, type BillItem } from "../src/bill-math.js";

const item = (id: string, unitPriceMinor: number, quantity: number, taxMinor = 0, discountMinor = 0): BillItem => ({
  id,
  name: id,
  quantity,
  unitPriceMinor,
  taxMinor,
  discountMinor,
});

describe("lineTotalsMinor", () => {
  it("adds each line's tax and spreads the service charge so lines sum to the total", () => {
    const items = [item("arepa", 600, 2, 192), item("jugo", 300, 1, 48)];
    // subtotal 1500, IVA 240, service 10% of subtotal = 150 → total 1890
    const totals = lineTotalsMinor(items, 1890);
    expect(totals).toEqual([1392 + 120, 348 + 30]);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(1890);
  });

  it("matches line bases exactly when the POS adds nothing on top", () => {
    const items = [item("a", 1200, 1, 120), item("b", 350, 2, 70)];
    expect(lineTotalsMinor(items, 1320 + 770)).toEqual([1320, 770]);
  });

  it("applies bill-level discounts too", () => {
    const totals = lineTotalsMinor([item("a", 1000, 1), item("b", 1000, 1)], 1801);
    expect(totals).toEqual([900, 901]);
  });
});

describe("billBreakdown", () => {
  it("separates subtotal, tax and service", () => {
    const items = [item("a", 600, 2, 192, 100), item("b", 300, 1, 48)];
    expect(billBreakdown(items, 140, 1780)).toEqual({
      subtotalMinor: 1400,
      taxMinor: 240,
      serviceChargeMinor: 140,
      totalMinor: 1780,
    });
  });
});
