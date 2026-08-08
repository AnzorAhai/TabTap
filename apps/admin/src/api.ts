import type { AdminPaymentView, AdminTableView } from "@tabtap/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function listTables(): Promise<AdminTableView[]> {
  return request("/admin/tables");
}

export function listPayments(): Promise<AdminPaymentView[]> {
  return request("/admin/payments");
}
