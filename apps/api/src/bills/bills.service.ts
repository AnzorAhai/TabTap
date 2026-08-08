import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Bill, Split } from "@tabtap/shared";
import { POS_CONNECTOR, POSConnector } from "../integrations/pos/pos-connector.interface";
import { TablesRepository } from "../tables/tables.repository";
import { BillsRepository } from "./bills.repository";
import { SplitsRepository } from "./splits.repository";

@Injectable()
export class BillsService {
  constructor(
    @Inject(POS_CONNECTOR) private readonly posConnector: POSConnector,
    private readonly tablesRepository: TablesRepository,
    private readonly billsRepository: BillsRepository,
    private readonly splitsRepository: SplitsRepository,
  ) {}

  async getBillForTable(qrToken: string): Promise<Bill> {
    const table = await this.tablesRepository.findByQrToken(qrToken);
    const posBill = await this.posConnector.getOpenBill(qrToken);
    if (!posBill) {
      throw new NotFoundException(`No open bill for table ${qrToken}`);
    }
    return this.billsRepository.upsertFromPosSnapshot(posBill, table);
  }

  async getBill(billId: string): Promise<Bill> {
    return this.billsRepository.findById(billId);
  }

  // Re-syncs our snapshot after something changed the bill on the POS side (e.g. a payment).
  async refreshBillFromPos(bill: Bill): Promise<Bill> {
    const posBill = await this.posConnector.getBillDetails(bill.externalPosId);
    return this.billsRepository.upsertFromPosSnapshot(posBill, {
      id: bill.tableId,
      tenantId: bill.tenantId,
      venueId: bill.venueId,
    });
  }

  async createEqualSplit(billId: string, participantsCount: number): Promise<Split> {
    const bill = await this.billsRepository.findById(billId);
    const remainingMinor = bill.totalMinor - bill.paidMinor;
    return this.splitsRepository.createEqualSplit(bill.tenantId, billId, remainingMinor, participantsCount);
  }

  async getSplit(splitId: string): Promise<Split> {
    return this.splitsRepository.findById(splitId);
  }

  async markParticipantPaid(splitId: string, participantId: string, amountMinor: number): Promise<Split> {
    await this.splitsRepository.addParticipantPayment(splitId, participantId, amountMinor);
    return this.splitsRepository.findById(splitId);
  }
}
