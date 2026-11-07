import type { BillItem } from "@tabtap/shared";

/** A bill as the POS reports it. TabTap stores a snapshot of this per table. */
export interface PosBill {
  /** The POS's id for the bill; a new bill on the same table gets a new id. */
  externalId: string;
  currency: string;
  items: BillItem[];
  /** Service charge the POS adds on top of the lines (e.g. Venezuela's customary 10%). */
  serviceChargeMinor: number;
  /** What the guest owes in total, as the POS computes it. */
  totalMinor: number;
  /** "closed" once the POS has closed the bill (paid at the register, voided, ...). */
  status: "open" | "closed";
}

export interface MarkPaidInput {
  paymentId: string;
  /** Part of the bill covered, in the bill currency. */
  amountMinor: number;
  tipMinor: number;
  currency: string;
}

// Every POS integration (iiko, r_keeper, Toast, ...) implements this contract.
// Core domain code depends only on this interface, never on a concrete POS SDK.
export interface POSConnector {
  readonly type: string;

  /** The open bill on a table, by the POS's own table reference; null if there is none. */
  getOpenBill(posTableRef: string): Promise<PosBill | null>;
  /** Tells the POS a TabTap payment was made against one of its bills. Must be idempotent per paymentId. */
  markPaid(externalBillId: string, payment: MarkPaidInput): Promise<void>;
  healthCheck(): Promise<boolean>;
}

export const POS_CONNECTOR = Symbol("POS_CONNECTOR");
