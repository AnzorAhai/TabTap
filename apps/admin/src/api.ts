import type {
  AdminPaymentView,
  AdminTableView,
  CreateTableRequest,
  CreateTenantRequest,
  CreateTenantResult,
  DailySummaryView,
  ExchangeRateView,
  FeeReportView,
  PaymentView,
  TenantPaymentMethodView,
  InviteInfoView,
  InviteLinkView,
  InviteStaffRequest,
  InviteStaffResult,
  LiveTableView,
  MeView,
  PaymentsQuery,
  PlatformTenantView,
  SessionView,
  SetExchangeRateRequest,
  StaffMemberView,
  StaffRole,
  TenantSettingsView,
  UpdatePlatformTenantRequest,
  UpdateTableRequest,
  UpdateTenantSettingsRequest,
  VenueRequest,
  VenueView,
} from "@tabtap/shared";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const TOKEN_KEY = "tabtap.admin.token";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The session token lives in this browser only. Storage can be unavailable
// (private mode, blocked site data): then the session lasts until the tab closes.
let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();
let sessionExpired: () => void = () => {};

export function hasSession(): boolean {
  return token !== null;
}

export function setSession(session: SessionView | null): void {
  token = session?.token ?? null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // keep it in memory only
  }
}

/** Called when the API rejects the stored session (expired, signed out elsewhere). */
export function onSessionExpired(callback: () => void): void {
  sessionExpired = callback;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Network error");
  }
  if (res.status === 401 && token) {
    setSession(null);
    sessionExpired();
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      if (data.message) message = Array.isArray(data.message) ? data.message.join("; ") : data.message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const t = (tenantId: string) => `/tenants/${tenantId}`;

export const api = {
  login: (email: string, password: string) => request<SessionView>("POST", "/auth/login", { email, password }),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<MeView>("GET", "/auth/me"),
  invite: (inviteToken: string) => request<InviteInfoView>("GET", `/auth/invites/${encodeURIComponent(inviteToken)}`),
  acceptInvite: (inviteToken: string, password: string, name?: string) =>
    request<SessionView>("POST", `/auth/invites/${encodeURIComponent(inviteToken)}/accept`, { password, name }),

  settings: (tenantId: string) => request<TenantSettingsView>("GET", t(tenantId)),
  updateSettings: (tenantId: string, body: UpdateTenantSettingsRequest) =>
    request<TenantSettingsView>("PATCH", `${t(tenantId)}/settings`, body),
  venues: (tenantId: string) => request<VenueView[]>("GET", `${t(tenantId)}/venues`),
  createVenue: (tenantId: string, body: VenueRequest) => request<VenueView>("POST", `${t(tenantId)}/venues`, body),
  tables: (tenantId: string) => request<AdminTableView[]>("GET", `${t(tenantId)}/tables`),
  createTable: (tenantId: string, body: CreateTableRequest) =>
    request<AdminTableView>("POST", `${t(tenantId)}/tables`, body),
  updateTable: (tenantId: string, tableId: string, body: UpdateTableRequest) =>
    request<AdminTableView>("PATCH", `${t(tenantId)}/tables/${tableId}`, body),
  rotateQr: (tenantId: string, tableId: string) =>
    request<AdminTableView>("POST", `${t(tenantId)}/tables/${tableId}/rotate-qr`),
  liveTables: (tenantId: string) => request<LiveTableView[]>("GET", `${t(tenantId)}/tables/live`),
  summary: (tenantId: string, date?: string) =>
    request<DailySummaryView>("GET", `${t(tenantId)}/summary${date ? `?date=${date}` : ""}`),
  payments: (tenantId: string, query: PaymentsQuery = {}) => {
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    return request<AdminPaymentView[]>("GET", `${t(tenantId)}/payments?${params.toString()}`);
  },
  refundPayment: (tenantId: string, paymentId: string, reason?: string) =>
    request<PaymentView>("POST", `${t(tenantId)}/payments/${paymentId}/refund`, { reason }),
  confirmPayment: (tenantId: string, paymentId: string) =>
    request<PaymentView>("POST", `${t(tenantId)}/payments/${paymentId}/confirm`),
  rejectPayment: (tenantId: string, paymentId: string, reason?: string) =>
    request<PaymentView>("POST", `${t(tenantId)}/payments/${paymentId}/reject`, { reason }),
  paymentMethods: (tenantId: string) => request<TenantPaymentMethodView[]>("GET", `${t(tenantId)}/payment-methods`),
  updatePaymentMethods: (tenantId: string, methods: TenantPaymentMethodView[]) =>
    request<TenantPaymentMethodView[]>("PUT", `${t(tenantId)}/payment-methods`, { methods }),
  fees: (tenantId: string, month: string) => request<FeeReportView>("GET", `${t(tenantId)}/fees?month=${month}`),
  refreshBcv: (tenantId: string) => request<ExchangeRateView>("POST", `${t(tenantId)}/exchange-rates/bcv`),
  rates: (tenantId: string) => request<ExchangeRateView[]>("GET", `${t(tenantId)}/exchange-rates`),
  setRate: (tenantId: string, body: SetExchangeRateRequest) =>
    request<ExchangeRateView>("POST", `${t(tenantId)}/exchange-rates`, body),
  staff: (tenantId: string) => request<StaffMemberView[]>("GET", `${t(tenantId)}/staff`),
  inviteStaff: (tenantId: string, body: InviteStaffRequest) =>
    request<InviteStaffResult>("POST", `${t(tenantId)}/staff`, body),
  staffInviteLink: (tenantId: string, userId: string) =>
    request<InviteLinkView>("POST", `${t(tenantId)}/staff/${userId}/invite-link`),
  changeRole: (tenantId: string, userId: string, role: StaffRole) =>
    request<StaffMemberView>("PATCH", `${t(tenantId)}/staff/${userId}`, { role }),
  removeStaff: (tenantId: string, userId: string) => request<void>("DELETE", `${t(tenantId)}/staff/${userId}`),

  platformTenants: () => request<PlatformTenantView[]>("GET", "/platform/tenants"),
  platformFees: (month: string) => request<FeeReportView>("GET", `/platform/fees?month=${month}`),
  createTenant: (body: CreateTenantRequest) => request<CreateTenantResult>("POST", "/platform/tenants", body),
  updateTenant: (tenantId: string, body: UpdatePlatformTenantRequest) =>
    request<PlatformTenantView>("PATCH", `/platform/tenants/${tenantId}`, body),
  passwordLink: (email: string) => request<InviteLinkView>("POST", "/platform/password-links", { email }),
};
