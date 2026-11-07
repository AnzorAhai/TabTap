// Request and response shapes of the HTTP API, shared by the backend and the frontends.
// Money is always in minor units; `currency` fields are ISO 4217 codes.

import type { BillStatus, ClaimState, PaymentMode, PaymentStatus } from "./status.js";

export interface BillItemView {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  /** What paying for this line costs, including its tax and share of the service charge. */
  lineTotalMinor: number;
  state: ClaimState;
}

export interface EqualSplitShareView {
  /** 0-based; shares are taken in index order. */
  index: number;
  amountMinor: number;
  state: ClaimState;
}

export interface EqualSplitView {
  shareCount: number;
  /**
   * False until the first share payment starts. Until then share amounts follow the
   * bill's remaining amount; after that they are fixed.
   */
  frozen: boolean;
  shares: EqualSplitShareView[];
}

export interface PaymentCurrencyOption {
  currency: string;
  /** Units of this currency per one unit of the bill currency; null for the bill currency itself. */
  rate: string | null;
  rateEffectiveAt: string | null;
}

export interface BillView {
  id: string;
  tenantName: string;
  venueName: string;
  tableLabel: string;
  currency: string;
  status: BillStatus;
  items: BillItemView[];
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  totalMinor: number;
  /** Settled TabTap payments. */
  paidMinor: number;
  /** Held by payments that are still in progress. */
  reservedMinor: number;
  /** What can be paid right now: total − paid − reserved. */
  remainingMinor: number;
}

/** Everything a guest's screen needs for one table, returned by GET /tables/:qrToken/bill. */
export interface TableBillView {
  bill: BillView;
  equalSplit: EqualSplitView | null;
  /** Which payment modes can be started right now. */
  modes: Record<PaymentMode, boolean>;
  paymentCurrencies: PaymentCurrencyOption[];
  tipPercentOptions: number[];
  /** How long a started payment holds its items/shares before they are released. */
  holdMinutes: number;
}

/** POST /bills/:billId/payments — the server computes every amount from this. */
export interface CreatePaymentRequest {
  mode: PaymentMode;
  /** mode = "items": the bill lines to pay for. */
  itemIds?: string[];
  /** mode = "shares": how many shares of the equal split to pay for. */
  shareCount?: number;
  /** Tip as a percentage of the amount paid (bill currency). Defaults to 0. */
  tipPercent?: number;
  /** Currency to pay in: the bill currency or one listed in `paymentCurrencies`. */
  currency: string;
}

export interface PaymentView {
  id: string;
  billId: string;
  mode: PaymentMode;
  status: PaymentStatus;
  /** Part of the bill this payment covers, in the bill currency. */
  amountMinor: number;
  tipMinor: number;
  currency: string;
  /** What the guest is charged: (amount + tip) converted to the payment currency. */
  chargeAmountMinor: number;
  chargeCurrency: string;
  /** Units of chargeCurrency per unit of currency; null when no conversion. */
  exchangeRate: string | null;
  itemIds: string[] | null;
  shareIndices: number[] | null;
  /** When the hold on items/shares ends if the payment is still pending. */
  expiresAt: string | null;
  createdAt: string;
  settledAt: string | null;
  failureReason: string | null;
}

/** PUT /bills/:billId/equal-split */
export interface SetEqualSplitRequest {
  shareCount: number;
}

/** Payment confirmation shown to the guest — not a fiscal document. */
export interface ReceiptView {
  receiptId: string;
  paymentId: string;
  tenantName: string;
  venueName: string;
  tableLabel: string;
  mode: PaymentMode;
  items: { name: string; quantity: number; lineTotalMinor: number }[] | null;
  shareCount: number | null;
  amountMinor: number;
  tipMinor: number;
  currency: string;
  chargeAmountMinor: number;
  chargeCurrency: string;
  exchangeRate: string | null;
  paidAt: string;
}

/** Server-sent event on GET /bills/:billId/events. On "bill.updated", refetch the bill. */
export interface BillEvent {
  kind: "bill.updated" | "ping";
  billId: string;
  at: string;
}

export interface AdminTableView {
  id: string;
  label: string;
  qrToken: string;
  isActive: boolean;
  guestUrl: string;
}

export interface AdminPaymentView {
  id: string;
  billId: string;
  tableLabel: string;
  mode: PaymentMode;
  amountMinor: number;
  tipMinor: number;
  platformFeeMinor: number;
  currency: string;
  chargeAmountMinor: number;
  chargeCurrency: string;
  status: PaymentStatus;
  createdAt: string;
}

export interface ExchangeRateView {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  effectiveAt: string;
}

/** POST /admin/exchange-rates */
export interface SetExchangeRateRequest {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
}
