import type { ReceiptView } from "@tabtap/shared";

// What the guest's browser remembers per bill, so it survives a reload — on phones a tab
// is often reloaded after the guest switches to their banking app to make a transfer.
// Best effort: storage can be unavailable (private mode, blocked site data).

const receiptsKey = (billId: string) => `tabtap.receipts.${billId}`;
const activePaymentKey = (billId: string) => `tabtap.payment.${billId}`;

export function loadReceipts(billId: string): ReceiptView[] {
  try {
    return JSON.parse(localStorage.getItem(receiptsKey(billId)) ?? "[]") as ReceiptView[];
  } catch {
    return [];
  }
}

export function saveReceipt(billId: string, receipt: ReceiptView): ReceiptView[] {
  const receipts = [...loadReceipts(billId).filter((r) => r.paymentId !== receipt.paymentId), receipt];
  try {
    localStorage.setItem(receiptsKey(billId), JSON.stringify(receipts));
  } catch {
    // keep them in memory only
  }
  return receipts;
}

/** The payment this guest has in progress on the bill, if any. */
export function loadActivePayment(billId: string): string | null {
  try {
    return localStorage.getItem(activePaymentKey(billId));
  } catch {
    return null;
  }
}

export function rememberActivePayment(billId: string, paymentId: string | null): void {
  try {
    if (paymentId) localStorage.setItem(activePaymentKey(billId), paymentId);
    else localStorage.removeItem(activePaymentKey(billId));
  } catch {
    // only lost if the tab reloads
  }
}
