import type { ReceiptView } from "@tabtap/shared";

// The guest's own receipts for a bill, kept in this browser so they survive a reload.
// Best effort: storage can be unavailable (private mode, blocked site data).

const key = (billId: string) => `tabtap.receipts.${billId}`;

export function loadReceipts(billId: string): ReceiptView[] {
  try {
    return JSON.parse(localStorage.getItem(key(billId)) ?? "[]") as ReceiptView[];
  } catch {
    return [];
  }
}

export function saveReceipt(billId: string, receipt: ReceiptView): ReceiptView[] {
  const receipts = [...loadReceipts(billId).filter((r) => r.paymentId !== receipt.paymentId), receipt];
  try {
    localStorage.setItem(key(billId), JSON.stringify(receipts));
  } catch {
    // keep them in memory only
  }
  return receipts;
}
