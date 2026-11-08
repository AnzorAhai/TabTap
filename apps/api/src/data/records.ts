// Typed rows as the API works with them internally. Repositories map database rows
// (snake_case, BIGINT as string, NUMERIC as string) into these.

import type { BillItem, BillStatus, PaymentMethod, PaymentMode, PaymentStatus } from "@tabtap/shared";

/** A table plus the restaurant settings needed to serve a guest at it. */
export interface TableContext {
  tableId: string;
  tableLabel: string;
  qrToken: string;
  posTableRef: string;
  isActive: boolean;
  tenantId: string;
  tenantName: string;
  /** False while the restaurant is suspended by the platform: guests can't open its tables. */
  tenantActive: boolean;
  venueId: string;
  venueName: string;
  platformFeeBps: number;
  /** Currencies accepted besides the bill currency. */
  paymentCurrencies: string[];
  tipPercentOptions: number[];
}

export interface BillRecord {
  id: string;
  tenantId: string;
  venueId: string;
  tableId: string;
  externalPosId: string;
  currency: string;
  items: BillItem[];
  serviceChargeMinor: number;
  totalMinor: number;
  /** Sum of settled TabTap payments (kept in sync on every settlement). */
  paidMinor: number;
  posStatus: "open" | "closed";
  status: BillStatus;
  lastSyncedAt: Date;
  updatedAt: Date;
}

export interface PaymentRecord {
  id: string;
  tenantId: string;
  billId: string;
  mode: PaymentMode;
  status: PaymentStatus;
  itemIds: string[] | null;
  shareIndices: number[] | null;
  /** Bill currency. */
  amountMinor: number;
  tipMinor: number;
  platformFeeMinor: number;
  currency: string;
  chargeCurrency: string;
  /** Includes the surcharge. */
  chargeAmountMinor: number;
  exchangeRate: string | null;
  method: PaymentMethod;
  surchargeBps: number;
  /** Charge currency. */
  surchargeMinor: number;
  /** Reported by the guest for proof-based methods. */
  proof: Record<string, string> | null;
  proofSubmittedAt: Date | null;
  reviewedBy: string | null;
  /** "offline" for methods confirmed by staff or proof, else the gateway's type. */
  provider: string;
  providerRef: string | null;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  settledAt: Date | null;
  failureReason: string | null;
}

export interface EqualSplitRecord {
  billId: string;
  tenantId: string;
  shareCount: number;
  /** Set (with frozenAt) when the first share payment starts. */
  baseAmountMinor: number | null;
  frozenAt: Date | null;
}

export interface ExchangeRateRecord {
  tenantId: string;
  baseCurrency: string;
  quoteCurrency: string;
  /** Normalized decimal string, e.g. "236.5". */
  rate: string;
  source: string;
  effectiveAt: Date;
}

/** "236.50000000" → "236.5", "40.00000000" → "40". */
export function normalizeDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}
