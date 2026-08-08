import type { Bill, Payment, ReceiptView, Split } from "@tabtap/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function getBillForTable(tableId: string): Promise<Bill> {
  return request(`/tables/${tableId}/bill`);
}

export function createSplit(billId: string, participantsCount: number): Promise<Split> {
  return request(`/bills/${billId}/splits`, {
    method: "POST",
    body: JSON.stringify({ participantsCount }),
  });
}

export function getSplit(splitId: string): Promise<Split> {
  return request(`/splits/${splitId}`);
}

export function createPayment(input: {
  billId: string;
  splitId: string;
  participantId: string;
  amountMinor: number;
  currency: string;
}): Promise<Payment> {
  return request(`/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getReceipt(paymentId: string): Promise<ReceiptView> {
  return request(`/payments/${paymentId}/receipt`);
}
