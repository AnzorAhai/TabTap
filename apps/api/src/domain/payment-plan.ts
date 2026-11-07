import { BadRequestException, ConflictException } from "@nestjs/common";
import { PaymentMode, splitEvenly } from "@tabtap/shared";
import type { BillRecord } from "../data/records";
import type { BillState } from "./bill-state";

export interface PaymentPlan {
  mode: PaymentMode;
  /** Part of the bill covered, in the bill currency. */
  amountMinor: number;
  itemIds: string[] | null;
  shareIndices: number[] | null;
  /** Set when this payment is the first share payment: the split's amounts get fixed to this base. */
  freezeSplitAt: number | null;
}

export interface PaymentPlanRequest {
  mode: PaymentMode;
  itemIds?: string[];
  shareCount?: number;
}

/**
 * Decides what a new payment covers and how much of the bill that is — from the
 * bill's current state, never from amounts sent by the client. Throws an HTTP
 * exception explaining why when the payment isn't possible right now.
 */
export function planPayment(bill: BillRecord, state: BillState, request: PaymentPlanRequest): PaymentPlan {
  if (state.status === "closed") throw new ConflictException("This bill is closed");
  if (state.status === "paid") throw new ConflictException("This bill is already paid");

  switch (request.mode) {
    case PaymentMode.FULL: {
      if (state.remainingMinor === 0) {
        throw new ConflictException("Nothing left to pay: the rest of the bill is being paid by someone else");
      }
      return {
        mode: request.mode,
        amountMinor: state.remainingMinor,
        itemIds: null,
        shareIndices: null,
        freezeSplitAt: null,
      };
    }

    case PaymentMode.ITEMS: {
      const itemIds = request.itemIds ?? [];
      if (itemIds.length === 0) throw new BadRequestException("Choose at least one item to pay for");
      if (state.equalSplit?.frozen) {
        throw new ConflictException("This bill is being split equally; pay a share instead");
      }
      const byId = new Map(bill.items.map((item) => [item.id, item]));
      const unknown = itemIds.filter((id) => !byId.has(id));
      if (unknown.length > 0) throw new BadRequestException(`Unknown bill items: ${unknown.join(", ")}`);
      const taken = itemIds.filter((id) => state.itemStates.get(id) !== "available");
      if (taken.length > 0) {
        const names = taken.map((id) => byId.get(id)!.name).join(", ");
        throw new ConflictException(`Already paid or being paid by someone else: ${names}`);
      }
      const amountMinor = itemIds.reduce((total, id) => total + state.lineTotals.get(id)!, 0);
      if (amountMinor <= 0) throw new BadRequestException("The selected items have nothing to pay");
      if (amountMinor > state.remainingMinor) {
        throw new ConflictException("The selected items cost more than what is left to pay on this bill");
      }
      // Keep the bill's own line order, whatever order the client sent.
      const ordered = bill.items.map((item) => item.id).filter((id) => itemIds.includes(id));
      return { mode: request.mode, amountMinor, itemIds: ordered, shareIndices: null, freezeSplitAt: null };
    }

    case PaymentMode.SHARES: {
      const split = state.equalSplit;
      if (!split) throw new ConflictException("Split the bill equally first");
      const count = request.shareCount ?? 1;
      if (!Number.isInteger(count) || count < 1 || count > split.shareCount) {
        throw new BadRequestException(`shareCount must be between 1 and ${split.shareCount}`);
      }
      const available = split.shareStates.flatMap((s, i) => (s === "available" ? [i] : []));
      if (available.length < count) {
        throw new ConflictException(
          available.length === 0
            ? "All shares are paid or being paid"
            : `Only ${available.length} share(s) left to pay`,
        );
      }
      const shareIndices = available.slice(0, count);
      // The first share payment fixes the split to what is payable at this moment.
      const freezeSplitAt = split.frozen ? null : state.remainingMinor;
      const amounts = split.frozen ? split.shareAmounts : splitEvenly(state.remainingMinor, split.shareCount);
      // Shares never exceed what is actually left (e.g. after the bill shrank on the POS).
      const amountMinor = Math.min(
        shareIndices.reduce((total, i) => total + amounts[i], 0),
        state.remainingMinor,
      );
      if (amountMinor <= 0) throw new ConflictException("Nothing left to pay on this bill");
      return { mode: request.mode, amountMinor, itemIds: null, shareIndices, freezeSplitAt };
    }

    default:
      throw new BadRequestException(`Unknown payment mode`);
  }
}
