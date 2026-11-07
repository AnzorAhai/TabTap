import type { AdminPaymentView, AdminTableView, ExchangeRateView } from "@tabtap/shared";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function listTables(): Promise<AdminTableView[]> {
  return request("/admin/tables");
}

export function listPayments(): Promise<AdminPaymentView[]> {
  return request("/admin/payments");
}

export function listExchangeRates(): Promise<ExchangeRateView[]> {
  return request("/admin/exchange-rates");
}
