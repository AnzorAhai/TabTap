// All money is handled as integers in the currency's minor unit (cents, céntimos, ...).
// These helpers never round through floating point.

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits of an ISO 4217 currency (USD → 2, CLP → 0, KWD → 3). */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  let exponent = exponentCache.get(code);
  if (exponent === undefined) {
    try {
      exponent = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits!;
    } catch {
      exponent = 2;
    }
    exponentCache.set(code, exponent);
  }
  return exponent;
}

/** How people in our markets write these; Intl gives "USD", "VES" or "Bs.S" depending on the locale. */
const LOCAL_SYMBOLS: Record<string, string> = { USD: "$", VES: "Bs" };

/** Formats a minor-unit amount for display, e.g. (123456, "USD", "es-VE") → "$ 1.234,56". */
export function formatMoney(amountMinor: number, currency: string, locale?: string): string {
  const exponent = currencyExponent(currency);
  const symbol = LOCAL_SYMBOLS[currency.toUpperCase()];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })
    .formatToParts(amountMinor / 10 ** exponent)
    .map((part) => (part.type === "currency" && symbol ? symbol : part.value))
    .join("");
}

/** Exact plain decimal of a minor-unit amount, for exports: (123456, "USD") → "1234.56". */
export function minorToDecimal(amountMinor: number, currency: string): string {
  assertInteger(amountMinor, "amountMinor");
  const exponent = currencyExponent(currency);
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, "0");
  const sign = amountMinor < 0 ? "-" : "";
  return exponent === 0 ? sign + digits : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * Splits `total` into `parts` integers that differ by at most 1 and sum exactly to
 * `total`; the first parts absorb the remainder: (100, 3) → [34, 33, 33].
 */
export function splitEvenly(total: number, parts: number): number[] {
  assertInteger(total, "total");
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError(`parts must be a positive integer (got ${parts})`);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Distributes `total` across `weights` proportionally, as integers that sum exactly
 * to `total` (largest-remainder method; ties go to the earlier weight). With all
 * weights zero the total is split evenly.
 */
export function allocateProportionally(total: number, weights: readonly number[]): number[] {
  assertInteger(total, "total");
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError("cannot allocate a non-zero total across no weights");
    return [];
  }
  weights.forEach((w) => {
    assertInteger(w, "weight");
    if (w < 0) throw new RangeError(`weights must be non-negative (got ${w})`);
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) return splitEvenly(total, weights.length);

  const sign = total < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(total));
  const sum = BigInt(weightSum);
  const shares = weights.map((w) => (abs * BigInt(w)) / sum);
  const remainders = weights.map((w, i) => ({ i, rest: (abs * BigInt(w)) % sum }));
  let left = abs - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.rest === b.rest ? a.i - b.i : a.rest > b.rest ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map((s) => Number(sign * s));
}

/** `amount × basisPoints / 10 000`, rounded half up (150 bps = 1.5%). */
export function basisPointsOf(amountMinor: number, basisPoints: number): number {
  assertInteger(amountMinor, "amountMinor");
  assertInteger(basisPoints, "basisPoints");
  return roundDiv(BigInt(amountMinor) * BigInt(basisPoints), 10_000n);
}

/** `amount × percent / 100`, rounded half up. */
export function percentOf(amountMinor: number, percent: number): number {
  assertInteger(amountMinor, "amountMinor");
  if (!Number.isFinite(percent) || percent < 0) throw new RangeError(`percent must be >= 0 (got ${percent})`);
  return basisPointsOf(amountMinor, Math.round(percent * 100));
}

const RATE_SCALE_DIGITS = 8;

/**
 * Converts a minor-unit amount between currencies. `rate` is how many units of
 * `to` one unit of `from` buys, as a decimal string ("236.5" VES per USD).
 * Rounded half up to the target currency's minor unit.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rate: string): number {
  assertInteger(amountMinor, "amountMinor");
  if (from.toUpperCase() === to.toUpperCase()) return amountMinor;
  const scaledRate = parseDecimal(rate, RATE_SCALE_DIGITS);
  if (scaledRate <= 0n) throw new RangeError(`rate must be positive (got ${rate})`);
  const shift = currencyExponent(to) - currencyExponent(from);
  let numerator = BigInt(amountMinor) * scaledRate;
  let denominator = 10n ** BigInt(RATE_SCALE_DIGITS);
  if (shift >= 0) numerator *= 10n ** BigInt(shift);
  else denominator *= 10n ** BigInt(-shift);
  return roundDiv(numerator, denominator);
}

/** Parses "236.45" into a bigint scaled by 10^digits; rejects anything but plain decimals. */
function parseDecimal(value: string, digits: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`not a decimal number: "${value}"`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > digits) throw new RangeError(`at most ${digits} decimal places allowed: "${value}"`);
  return BigInt(whole + fraction.padEnd(digits, "0"));
}

/** Integer division rounded half away from zero. */
function roundDiv(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return Number(negative ? -q : q);
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer (got ${value})`);
}
