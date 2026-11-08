import type { CreatePaymentRequest, PaymentView, ReceiptView, SubmitProofRequest, TableBillView } from "@tabtap/shared";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 when the request never got a response (offline, DNS, CORS). */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    } catch {
      // not JSON — keep the status text
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  tableBill: (qrToken: string) => request<TableBillView>(`/tables/${encodeURIComponent(qrToken)}/bill`),

  setEqualSplit: (billId: string, shareCount: number) =>
    request<TableBillView>(`/bills/${billId}/equal-split`, { method: "PUT", body: JSON.stringify({ shareCount }) }),

  removeEqualSplit: (billId: string) => request<TableBillView>(`/bills/${billId}/equal-split`, { method: "DELETE" }),

  /** `idempotencyKey` must stay the same when retrying the same "Pay" tap. */
  createPayment: (billId: string, body: CreatePaymentRequest, idempotencyKey: string) =>
    request<PaymentView>(`/bills/${billId}/payments`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": idempotencyKey },
    }),

  payment: (paymentId: string) => request<PaymentView>(`/payments/${paymentId}`),

  /** Report a payment made outside TabTap (Pago Móvil reference, Zelle confirmation, …). */
  submitProof: (paymentId: string, body: SubmitProofRequest) =>
    request<PaymentView>(`/payments/${paymentId}/proof`, { method: "POST", body: JSON.stringify(body) }),

  cancelPayment: (paymentId: string) => request<PaymentView>(`/payments/${paymentId}/cancel`, { method: "POST" }),

  /** Demo gateway only: stands in for the guest confirming in their banking app. */
  mockConfirm: (paymentId: string, outcome: "succeeded" | "failed") =>
    request<PaymentView>(`/payments/${paymentId}/mock-confirm`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    }),

  receipt: (paymentId: string) => request<ReceiptView>(`/payments/${paymentId}/receipt`),

  eventsUrl: (billId: string) => `${API_URL}/bills/${billId}/events`,
};
