import { BillStatus, lineTotalsMinor, PaymentMode, PaymentStatus, splitEvenly, type ClaimState } from "@tabtap/shared";
import type { BillRecord, EqualSplitRecord, PaymentRecord } from "../data/records";

/**
 * Everything that follows from a bill, its payments and its equal split at a given
 * moment. Pure: the single place that decides what is paid, held and still payable.
 */
export interface BillState {
  status: BillStatus;
  /** Bill line id → what paying for that line costs. */
  lineTotals: Map<string, number>;
  itemStates: Map<string, ClaimState>;
  paidMinor: number;
  reservedMinor: number;
  /** Payable right now: total − paid − reserved, never negative. */
  remainingMinor: number;
  equalSplit: {
    shareCount: number;
    frozen: boolean;
    shareAmounts: number[];
    shareStates: ClaimState[];
  } | null;
  modes: Record<PaymentMode, boolean>;
}

/** A pending payment holds what it covers only until its hold expires. */
export function isHolding(payment: PaymentRecord, now: Date): boolean {
  return (
    payment.status === PaymentStatus.PENDING &&
    (payment.expiresAt === null || payment.expiresAt.getTime() > now.getTime())
  );
}

export function computeBillState(
  bill: BillRecord,
  payments: readonly PaymentRecord[],
  split: EqualSplitRecord | null,
  now: Date,
): BillState {
  const settled = payments.filter((p) => p.status === PaymentStatus.SUCCEEDED);
  const holding = payments.filter((p) => isHolding(p, now));

  const paidMinor = sum(settled.map((p) => p.amountMinor));
  const reservedMinor = sum(holding.map((p) => p.amountMinor));
  const remainingMinor = Math.max(0, bill.totalMinor - paidMinor - reservedMinor);
  const fullyPaid = paidMinor >= bill.totalMinor;
  const open = bill.posStatus === "open" && !fullyPaid;

  const status: BillStatus =
    bill.posStatus === "closed"
      ? BillStatus.CLOSED
      : fullyPaid
        ? BillStatus.PAID
        : paidMinor > 0
          ? BillStatus.PARTIALLY_PAID
          : BillStatus.OPEN;

  // Bill lines.
  const totals = lineTotalsMinor(bill.items, bill.totalMinor);
  const lineTotals = new Map(bill.items.map((item, i) => [item.id, totals[i]]));
  const paidItems = new Set(settled.flatMap((p) => p.itemIds ?? []));
  const heldItems = new Set(holding.flatMap((p) => p.itemIds ?? []));
  const fullPaymentHolding = holding.some((p) => p.mode === PaymentMode.FULL);
  const itemStates = new Map<string, ClaimState>(
    bill.items.map((item) => {
      if (fullyPaid || paidItems.has(item.id)) return [item.id, "paid"];
      if (heldItems.has(item.id) || fullPaymentHolding) return [item.id, "reserved"];
      return [item.id, "available"];
    }),
  );

  // Equal split.
  let equalSplit: BillState["equalSplit"] = null;
  if (split) {
    const frozen = split.baseAmountMinor !== null;
    // Before the first share payment, shares divide whatever is payable right now.
    const shareAmounts = splitEvenly(frozen ? split.baseAmountMinor! : remainingMinor, split.shareCount);
    const paidShares = new Set(settled.flatMap((p) => p.shareIndices ?? []));
    const heldShares = new Set(holding.flatMap((p) => p.shareIndices ?? []));
    const shareStates = shareAmounts.map((_, i): ClaimState => {
      if (fullyPaid || paidShares.has(i)) return "paid";
      if (heldShares.has(i) || fullPaymentHolding) return "reserved";
      return "available";
    });
    equalSplit = { shareCount: split.shareCount, frozen, shareAmounts, shareStates };
  }

  const canPay = open && remainingMinor > 0;
  const modes: Record<PaymentMode, boolean> = {
    full: canPay,
    items: canPay && !equalSplit?.frozen && [...itemStates.values()].includes("available"),
    shares: canPay && equalSplit !== null && equalSplit.shareStates.includes("available"),
  };

  return { status, lineTotals, itemStates, paidMinor, reservedMinor, remainingMinor, equalSplit, modes };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
