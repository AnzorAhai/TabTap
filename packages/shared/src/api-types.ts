// Request and response shapes of the HTTP API, shared by the backend and the frontends.
// Money is always in minor units; `currency` fields are ISO 4217 codes.

import type { BillStatus, ClaimState, PaymentFlow, PaymentMethod, PaymentMode, PaymentStatus } from "./status.js";

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

/** A way to pay that the restaurant accepts, as offered to the guest. */
export interface PaymentMethodOption {
  method: PaymentMethod;
  /** Currency the guest pays in with this method. */
  currency: string;
  /** Units of this currency per one unit of the bill currency; null when it is the bill currency. */
  rate: string | null;
  rateEffectiveAt: string | null;
  /** Extra charge on top (e.g. IGTF 3% = 300), in basis points of the converted amount. */
  surchargeBps: number;
  flow: PaymentFlow;
  /** How long a payment with this method holds its items/shares before they are released. */
  holdMinutes: number;
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
  /** Methods the guest can pay with right now (those needing a missing exchange rate are left out). */
  paymentMethods: PaymentMethodOption[];
  tipPercentOptions: number[];
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
  /** One of the methods listed in `paymentMethods`; it decides the currency. */
  method: PaymentMethod;
}

/** POST /payments/:paymentId/proof — what the guest reports after paying outside TabTap. */
export interface SubmitProofRequest {
  /** Bank reference / Zelle confirmation / Binance order id. */
  reference: string;
  payerPhone?: string;
  payerBank?: string;
  payerName?: string;
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
  /** What the guest is charged: (amount + tip) converted to the payment currency, plus the surcharge. */
  chargeAmountMinor: number;
  chargeCurrency: string;
  /** Included in chargeAmountMinor (charge currency), e.g. IGTF. */
  surchargeMinor: number;
  /** Units of chargeCurrency per unit of currency; null when no conversion. */
  exchangeRate: string | null;
  method: PaymentMethod;
  flow: PaymentFlow;
  /** For "proof" and "staff" methods: where/how to pay (bank, phone, RIF, email, …). */
  payTo: Record<string, string> | null;
  /** The guest has reported the payment; it now waits for verification. */
  proofSubmitted: boolean;
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
  /** Included in chargeAmountMinor (charge currency), e.g. IGTF. */
  surchargeMinor: number;
  surchargeBps: number;
  exchangeRate: string | null;
  method: PaymentMethod;
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
  venueId: string;
  label: string;
  /** Random token in the table's QR code; rotating it invalidates printed codes. */
  qrToken: string;
  /** The POS's own id for this table (how bills are looked up). */
  posTableRef: string;
  isActive: boolean;
  guestUrl: string;
}

/** POST /tenants/:tenantId/tables */
export interface CreateTableRequest {
  venueId: string;
  label: string;
  posTableRef: string;
}

/** PATCH /tenants/:tenantId/tables/:tableId */
export interface UpdateTableRequest {
  label?: string;
  posTableRef?: string;
  isActive?: boolean;
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
  surchargeMinor: number;
  exchangeRate: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  /** What the guest reported for an offline payment (reference, payer phone/bank/name). */
  proof: Record<string, string> | null;
  /** Pending, and needs a staff member to confirm or reject it. */
  awaitingReview: boolean;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
}

/** GET /tenants/:tenantId/payments — dates are days in the restaurant's time zone, inclusive. */
export interface PaymentsQuery {
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  limit?: number;
  offset?: number;
}

/** POST /tenants/:tenantId/payments/:paymentId/refund */
export interface RefundPaymentRequest {
  reason?: string;
}

/** Money settled during one day in the restaurant's time zone. Refunded payments are left out. */
export interface DailySummaryView {
  /** YYYY-MM-DD */
  date: string;
  timeZone: string;
  /** Per bill currency. */
  totals: { currency: string; payments: number; amountMinor: number; tipMinor: number; feeMinor: number }[];
  /** What actually came in, per method and the currency it was paid in. */
  byMethod: { method: PaymentMethod; chargeCurrency: string; payments: number; chargeAmountMinor: number }[];
  /** Refunds made that day, per bill currency. */
  refunds: { currency: string; payments: number; amountMinor: number }[];
}

/** A table as staff see it right now: its current bill as TabTap knows it (guests have opened it). */
export interface LiveTableView {
  tableId: string;
  label: string;
  isActive: boolean;
  bill: {
    id: string;
    status: BillStatus;
    currency: string;
    totalMinor: number;
    paidMinor: number;
    /** Held by payments still in progress. */
    reservedMinor: number;
    remainingMinor: number;
    /** Payments waiting for a staff member to confirm them. */
    awaitingReview: number;
    updatedAt: string;
  } | null;
}

/** POST /tenants/:tenantId/payments/:paymentId/reject */
export interface RejectPaymentRequest {
  reason?: string;
}

/** A restaurant's configuration of one payment method. */
export interface TenantPaymentMethodView {
  method: PaymentMethod;
  enabled: boolean;
  surchargeBps: number;
  /** Payee details shown to guests, plus `verification`: "staff" | "simulated". */
  details: Record<string, string>;
  sortOrder: number;
}

/** PUT /tenants/:tenantId/payment-methods — the full list replaces the current one. */
export interface UpdatePaymentMethodsRequest {
  methods: TenantPaymentMethodView[];
}

/** Platform fees accrued in a calendar month (UTC), per currency — invoiced to the restaurant. */
export interface FeeReportRow {
  tenantId: string;
  tenantName: string;
  currency: string;
  payments: number;
  billAmountMinor: number;
  feeMinor: number;
}

export interface FeeReportView {
  /** "YYYY-MM" */
  month: string;
  rows: FeeReportRow[];
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

// ---------------------------------------------------------------------------
// Staff accounts, sessions and restaurant management (admin panel).

export type StaffRole = "owner" | "manager" | "waiter";

/** What a staff login may look like. Stored in lower case; an email address is a valid login. */
export const LOGIN_PATTERN = /^[A-Za-z0-9._\-@]{3,254}$/;

export interface MembershipView {
  tenantId: string;
  tenantName: string;
  role: StaffRole;
}

export interface MeView {
  userId: string;
  login: string;
  name: string;
  /** TabTap staff: may manage every restaurant and the platform settings. */
  isPlatformAdmin: boolean;
  memberships: MembershipView[];
}

/** Returned by login and by accepting an invite. Send `Authorization: Bearer <token>`. */
export interface SessionView {
  token: string;
  expiresAt: string;
  me: MeView;
}

/** POST /auth/login */
export interface LoginRequest {
  login: string;
  password: string;
}

/** GET /auth/invites/:token — what the set-password page shows. */
export interface InviteInfoView {
  login: string;
  name: string;
  purpose: "invite" | "password_reset";
  expiresAt: string;
}

/** POST /auth/invites/:token/accept */
export interface AcceptInviteRequest {
  password: string;
  name?: string;
}

/** A one-time link that lets someone set their password. Shown once; pass it on yourself. */
export interface InviteLinkView {
  userId: string;
  login: string;
  url: string;
  expiresAt: string;
}

export interface TenantSettingsView {
  id: string;
  name: string;
  country: string;
  defaultCurrency: string;
  status: "active" | "suspended";
  platformFeeBps: number;
  tipPercentOptions: number[];
  /** "bcv": the official BCV USD→VES rate is fetched automatically; "manual": entered by staff. */
  rateSource: "manual" | "bcv";
  /** The caller's role here; platform admins act as owners. */
  role: StaffRole;
  /** This restaurant runs on the demo POS: the panel shows the waiter's screen. */
  demoPos: boolean;
}

/** PATCH /tenants/:tenantId/settings */
export interface UpdateTenantSettingsRequest {
  name?: string;
  tipPercentOptions?: number[];
  rateSource?: "manual" | "bcv";
}

export interface VenueView {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
}

/** POST /tenants/:tenantId/venues, PATCH .../venues/:venueId */
export interface VenueRequest {
  name?: string;
  address?: string | null;
  timezone?: string;
}

export interface StaffMemberView {
  userId: string;
  login: string;
  name: string;
  role: StaffRole;
  /** invited = hasn't set a password yet. */
  status: "invited" | "active" | "disabled";
  lastLoginAt: string | null;
}

/** POST /tenants/:tenantId/staff */
export interface InviteStaffRequest {
  login: string;
  role: StaffRole;
  name?: string;
}

/** The invite link is null when the person already has an account (they just sign in). */
export interface InviteStaffResult {
  member: StaffMemberView;
  inviteLink: InviteLinkView | null;
}

export interface PlatformTenantView {
  id: string;
  name: string;
  country: string;
  defaultCurrency: string;
  status: "active" | "suspended";
  platformFeeBps: number;
  ownerLogins: string[];
  createdAt: string;
}

/** POST /platform/tenants */
export interface CreateTenantRequest {
  name: string;
  /** ISO 3166-1 alpha-2, e.g. "VE". */
  country: string;
  /** Currency the POS bills in, e.g. "USD". */
  defaultCurrency: string;
  venueName: string;
  /** IANA time zone, e.g. "America/Caracas". */
  timezone: string;
  ownerLogin: string;
}

export interface CreateTenantResult {
  tenant: PlatformTenantView;
  ownerInvite: InviteLinkView | null;
}

/** PATCH /platform/tenants/:tenantId */
export interface UpdatePlatformTenantRequest {
  platformFeeBps?: number;
  status?: "active" | "suspended";
}

// ---------------------------------------------------------------------------
// Demo POS (investor demos): the waiter's screen.

export interface DemoMenuItemView {
  id: string;
  category: string;
  name: string;
  /** Before IVA and service. */
  priceMinor: number;
}

export interface DemoPosOrderView {
  id: string;
  billId: string;
  openedAt: string;
  status: BillStatus;
  lines: { id: string; name: string; priceMinor: number; state: ClaimState }[];
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  totalMinor: number;
  paidMinor: number;
  reservedMinor: number;
  remainingMinor: number;
  /** Tips on settled payments. */
  tipMinor: number;
  /** Settled and in progress, newest first. */
  payments: {
    id: string;
    status: PaymentStatus;
    method: PaymentMethod;
    amountMinor: number;
    tipMinor: number;
    chargeAmountMinor: number;
    chargeCurrency: string;
  }[];
}

export interface DemoPosTableView {
  tableId: string;
  label: string;
  guestUrl: string;
  order: DemoPosOrderView | null;
}

/** GET /tenants/:tenantId/demo-pos */
export interface DemoPosView {
  /** Currency of menu prices and bills. */
  currency: string;
  /** Current rate from `currency`, for showing prices in bolívares. */
  rate: { currency: string; value: string } | null;
  menu: DemoMenuItemView[];
  tables: DemoPosTableView[];
}

/** POST /tenants/:tenantId/demo-pos/tables/:tableId/lines */
export interface AddDemoLineRequest {
  menuItemId: string;
}
