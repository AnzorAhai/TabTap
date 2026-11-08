import { describe, expect, it } from "vitest";
import { csvLine } from "../src/csv.js";
import { pickLanguage } from "../src/language.js";
import { formatMoney, minorToDecimal } from "../src/money.js";

describe("csvLine", () => {
  it("joins plain cells and leaves empty ones empty", () => {
    expect(csvLine(["a", 1, null, "b"])).toBe("a,1,,b");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(csvLine(['say "hi"', "a,b", "x\ny"])).toBe('"say ""hi""","a,b","x\ny"');
    expect(csvLine(["a;b", "a,b"], ";")).toBe('"a;b";a,b');
  });

  it("neutralizes anything a spreadsheet would run as a formula", () => {
    expect(csvLine(["=HYPERLINK(1)", "+1", "-1", "@x"])).toBe("'=HYPERLINK(1),'+1,'-1,'@x");
    expect(csvLine(['=A1,"b"'])).toBe(`"'=A1,""b"""`);
  });
});

describe("minorToDecimal", () => {
  it("writes the exact amount for the currency's minor unit", () => {
    expect(minorToDecimal(123456, "USD")).toBe("1234.56");
    expect(minorToDecimal(5, "USD")).toBe("0.05");
    expect(minorToDecimal(-250, "USD")).toBe("-2.50");
    expect(minorToDecimal(1500, "CLP")).toBe("1500");
  });
});

describe("formatMoney symbols", () => {
  const plain = (s: string) => s.replace(/\s/g, " ");

  it("writes dollars and bolívares the way people there do, in every language", () => {
    expect(plain(formatMoney(123456, "USD", "es-VE"))).toBe("$ 1.234,56");
    expect(plain(formatMoney(123456, "VES", "es-VE"))).toBe("Bs 1.234,56");
    expect(plain(formatMoney(123456, "VES", "en-US"))).toBe("Bs 1,234.56");
    expect(plain(formatMoney(123456, "VES", "ru-RU"))).toBe("1 234,56 Bs");
  });
});

describe("pickLanguage", () => {
  it("prefers the saved choice, then the browser, then Spanish", () => {
    expect(pickLanguage("ru", ["en-US"])).toBe("ru");
    expect(pickLanguage(null, ["fr-FR", "en-GB", "es"])).toBe("en");
    expect(pickLanguage("xx", ["de"])).toBe("es");
    expect(pickLanguage(null, [])).toBe("es");
  });
});
