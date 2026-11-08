// Status/type values are plain string-literal unions (not TS enums), so frontends
// can compare against "paid", "succeeded", ... using type-only imports, and the
// backend can still use the named constants below.

export const BillStatus = {
  OPEN: "open",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  CLOSED: "closed",
} as const;
export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus];

/** What a single payment covers. */
export const PaymentMode = {
  /** Everything still unpaid and not held by someone else's payment. */
  FULL: "full",
  /** Specific bill lines (whole lines; a line is paid by one guest). */
  ITEMS: "items",
  /** N shares of the table's equal split. */
  SHARES: "shares",
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const PaymentStatus = {
  /** Created; holds its items/shares until it settles, fails or expires. */
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  /** The hold ran out before the provider confirmed. */
  EXPIRED: "expired",
  /** The guest backed out. */
  CANCELED: "canceled",
  REFUNDED: "refunded",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** How a bill line or an equal-split share looks to guests right now. */
export type ClaimState = "available" | "reserved" | "paid";

/** Ways a guest can pay (Venezuela first). */
export const PaymentMethod = {
  CARD: "card",
  PAGO_MOVIL: "pago_movil",
  ZELLE: "zelle",
  BINANCE_PAY: "binance_pay",
  CASH_USD: "cash_usd",
  CASH_VES: "cash_ves",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * How a payment gets confirmed:
 *   gateway — the payment provider confirms it (card)
 *   proof   — the guest pays outside TabTap and reports a reference; staff (or the demo simulator) verify it
 *   staff   — a staff member confirms receiving it (cash)
 */
export type PaymentFlow = "gateway" | "proof" | "staff";

/** Fixed properties of each method; restaurants configure which ones they accept. */
export const PAYMENT_METHODS: Record<PaymentMethod, { currency: "bill" | "USD" | "VES"; flow: PaymentFlow }> = {
  card: { currency: "bill", flow: "gateway" },
  pago_movil: { currency: "VES", flow: "proof" },
  zelle: { currency: "USD", flow: "proof" },
  binance_pay: { currency: "USD", flow: "proof" },
  cash_usd: { currency: "USD", flow: "staff" },
  cash_ves: { currency: "VES", flow: "staff" },
};
