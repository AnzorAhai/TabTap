import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  basisPointsOf,
  convertMinor,
  currencyExponent,
  formatMoney,
  percentOf,
  splitEvenly,
} from "../src/money.js";

describe("currencyExponent", () => {
  it("knows currencies without, with two and with three minor digits", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("ves")).toBe(2);
    expect(currencyExponent("CLP")).toBe(0);
    expect(currencyExponent("XOF")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
});

describe("formatMoney", () => {
  it("uses the currency's own number of decimals", () => {
    expect(formatMoney(123456, "USD", "en-US")).toBe("$1,234.56");
    // Intl separates the currency code with a no-break space.
    expect(formatMoney(1500, "CLP", "en-US").replace(/\s/g, " ")).toBe("CLP 1,500");
  });
});

describe("splitEvenly", () => {
  it("sums exactly and puts the remainder on the first parts", () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(5, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(splitEvenly(2, 4)).toEqual([1, 1, 0, 0]);
    expect(splitEvenly(-100, 3)).toEqual([-34, -33, -33]);
  });

  it("rejects non-positive part counts", () => {
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
  });
});

describe("allocateProportionally", () => {
  it("always sums exactly to the total", () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [10, [3, 3, 4]],
      [1, [1000, 1, 1]],
      [999, [137, 2, 58, 1, 0]],
      [-7, [2, 5]],
    ] as const) {
      const result = allocateProportionally(total, weights);
      expect(result.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("is proportional and gives leftovers to the largest remainders", () => {
    expect(allocateProportionally(100, [1, 1, 2])).toEqual([25, 25, 50]);
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportionally(10, [0, 2, 1])).toEqual([0, 7, 3]);
  });

  it("splits evenly when every weight is zero", () => {
    expect(allocateProportionally(5, [0, 0])).toEqual([3, 2]);
  });
});

describe("percentOf / basisPointsOf", () => {
  it("rounds half up", () => {
    expect(basisPointsOf(1000, 150)).toBe(15); // 1.5%
    expect(basisPointsOf(1033, 150)).toBe(15); // 15.495
    expect(basisPointsOf(1034, 150)).toBe(16); // 15.51
    expect(basisPointsOf(100, 50)).toBe(1); // 0.5 → 1
    expect(percentOf(3080, 10)).toBe(308);
    expect(percentOf(3085, 10)).toBe(309); // 308.5 → 309
    expect(percentOf(1000, 12.5)).toBe(125);
  });
});

describe("convertMinor", () => {
  it("converts with an exact decimal rate", () => {
    expect(convertMinor(1000, "USD", "VES", "236.5")).toBe(236500); // $10.00 → Bs 2365.00
    expect(convertMinor(1, "USD", "VES", "236.5")).toBe(237); // $0.01 → Bs 2.365 → 2.37
    expect(convertMinor(1234, "USD", "VES", "0.1")).toBe(123); // 123.4 → 123
  });

  it("handles currencies with different minor units", () => {
    expect(convertMinor(1000, "USD", "CLP", "950")).toBe(9500); // $10.00 → 9 500 CLP
    expect(convertMinor(9500, "CLP", "USD", "0.00105263")).toBe(1000);
  });

  it("returns the amount unchanged for the same currency", () => {
    expect(convertMinor(777, "USD", "usd", "1")).toBe(777);
  });

  it("rejects malformed or non-positive rates", () => {
    expect(() => convertMinor(100, "USD", "VES", "1e3")).toThrow(RangeError);
    expect(() => convertMinor(100, "USD", "VES", "0")).toThrow(RangeError);
    expect(() => convertMinor(100, "USD", "VES", "-2")).toThrow(RangeError);
  });
});
