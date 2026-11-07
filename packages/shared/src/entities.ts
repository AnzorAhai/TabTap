export type Currency = string;

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

export const SplitType = {
  EQUAL: "equal",
  BY_ITEMS: "by_items",
  BY_GUEST: "by_guest",
} as const;
export type SplitType = (typeof SplitType)[keyof typeof SplitType];

export const PaymentStatus = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  REFUNDED: "refunded",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface Tenant {
  id: string;
  name: string;
  country: string;
  defaultCurrency: Currency;
  status: "active" | "suspended";
  createdAt: string;
}

export interface Venue {
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  timezone: string;
}

export interface Table {
  id: string;
  tenantId: string;
  venueId: string;
  label: string;
  qrToken: string;
  isActive: boolean;
}

// Money is stored in minor currency units (e.g. cents) to avoid float rounding errors.
export interface BillItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  taxMinor: number;
  discountMinor: number;
}

export interface Bill {
  id: string;
  tenantId: string;
  venueId: string;
  tableId: string;
  externalPosId: string;
  currency: Currency;
  items: BillItem[];
  totalMinor: number;
  paidMinor: number;
  status: BillStatus;
  lastSyncedAt: string;
}

export interface SplitParticipant {
  id: string;
  splitId: string;
  label: string;
  amountDueMinor: number;
  amountPaidMinor: number;
  itemIds?: string[];
}

export interface Split {
  id: string;
  billId: string;
  type: SplitType;
  participants: SplitParticipant[];
  createdAt: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  billId: string;
  splitParticipantId?: string;
  amountMinor: number;
  currency: Currency;
  tipMinor: number;
  platformFeeMinor: number;
  status: PaymentStatus;
  providerRef?: string;
  createdAt: string;
}

export interface Receipt {
  id: string;
  paymentId: string;
  url?: string;
  deliveredTo?: string;
  deliveredAt?: string;
}

// Composed, guest-facing view of a receipt — not a fiscal document, just a
// payment confirmation (fiscal requirements vary per country and are handled
// separately, see plan section on Fiscalization).
export interface ReceiptView {
  receiptId: string;
  paymentId: string;
  tenantName: string;
  venueName: string;
  participantLabel?: string;
  amountMinor: number;
  tipMinor: number;
  currency: Currency;
  paidAt: string;
}

export interface POSConnectorConfig {
  tenantId: string;
  venueId: string;
  type: string;
  credentialsRef: string;
  settings?: Record<string, unknown>;
}

export interface PaymentProviderConfig {
  tenantId: string;
  type: string;
  credentialsRef: string;
  supportedCurrencies: Currency[];
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
  participantLabel?: string;
  amountMinor: number;
  tipMinor: number;
  currency: Currency;
  status: PaymentStatus;
  createdAt: string;
}
