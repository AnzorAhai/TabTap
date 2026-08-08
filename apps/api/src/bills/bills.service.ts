import { randomUUID } from "crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Bill, Split, SplitParticipant, SplitType } from "@tabtap/shared";
import { POS_CONNECTOR, POSConnector } from "../integrations/pos/pos-connector.interface";

@Injectable()
export class BillsService {
  // MVP persistence: splits live in memory only. Real persistence (Postgres + RLS
  // per db/migrations/0001_init_schema.sql) is the next concrete step, not yet wired.
  private readonly splits = new Map<string, Split>();

  constructor(@Inject(POS_CONNECTOR) private readonly posConnector: POSConnector) {}

  async getBillForTable(tableId: string): Promise<Bill> {
    const bill = await this.posConnector.getOpenBill(tableId);
    if (!bill) {
      throw new NotFoundException(`No open bill for table ${tableId}`);
    }
    return bill;
  }

  async getBill(billId: string): Promise<Bill> {
    return this.posConnector.getBillDetails(billId);
  }

  async createEqualSplit(billId: string, participantsCount: number): Promise<Split> {
    const bill = await this.posConnector.getBillDetails(billId);
    const remainingMinor = bill.totalMinor - bill.paidMinor;
    const base = Math.floor(remainingMinor / participantsCount);
    const remainder = remainingMinor - base * participantsCount;

    const splitId = randomUUID();
    const participants: SplitParticipant[] = Array.from({ length: participantsCount }, (_, i) => ({
      id: randomUUID(),
      splitId,
      label: `Guest ${i + 1}`,
      // first `remainder` participants absorb the extra minor unit so the split sums exactly.
      amountDueMinor: base + (i < remainder ? 1 : 0),
      amountPaidMinor: 0,
    }));

    const split: Split = {
      id: splitId,
      billId,
      type: SplitType.EQUAL,
      participants,
      createdAt: new Date().toISOString(),
    };
    this.splits.set(split.id, split);
    return split;
  }

  async getSplit(splitId: string): Promise<Split> {
    const split = this.splits.get(splitId);
    if (!split) {
      throw new NotFoundException(`Split ${splitId} not found`);
    }
    return split;
  }

  async markParticipantPaid(
    splitId: string,
    participantId: string,
    amountMinor: number,
  ): Promise<Split> {
    const split = await this.getSplit(splitId);
    const participant = split.participants.find((p) => p.id === participantId);
    if (!participant) {
      throw new NotFoundException(`Participant ${participantId} not found in split ${splitId}`);
    }
    participant.amountPaidMinor += amountMinor;
    return split;
  }
}
