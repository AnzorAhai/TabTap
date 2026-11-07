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
