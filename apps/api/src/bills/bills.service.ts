import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { billBreakdown, type PaymentCurrencyOption, type TableBillView } from "@tabtap/shared";
import { Pool } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { BillsRepository } from "../data/bills.repository";
import { EqualSplitsRepository } from "../data/equal-splits.repository";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { PaymentsRepository } from "../data/payments.repository";
import type { BillRecord, TableContext } from "../data/records";
import { TablesRepository } from "../data/tables.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction } from "../database/transaction";
import { computeBillState } from "../domain/bill-state";
import { BillEventsService } from "../events/bill-events.service";
import { POS_CONNECTOR, type POSConnector } from "../integrations/pos/pos-connector.interface";

@Injectable()
export class BillsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(POS_CONNECTOR) private readonly pos: POSConnector,
    private readonly tables: TablesRepository,
    private readonly bills: BillsRepository,
    private readonly splits: EqualSplitsRepository,
    private readonly payments: PaymentsRepository,
    private readonly rates: ExchangeRatesRepository,
    private readonly events: BillEventsService,
  ) {}

  /** What a guest sees after scanning a table's QR code; refreshes the bill from the POS first. */
  async getTableView(qrToken: string): Promise<TableBillView> {
    const table = await this.tables.findContextByQrToken(qrToken);
    if (!table || !table.isActive || !table.tenantActive) throw new NotFoundException("Table not found");
    const posBill = await this.pos.getOpenBill(table.posTableRef);
    if (!posBill) throw new NotFoundException("There is no open bill on this table");
    const { bill, changed } = await this.bills.upsertFromPos(table, posBill);
    if (changed) this.events.emit(bill.id);
    return this.buildView(bill, table);
  }

  /** The same view by bill id, without asking the POS (used to refresh after an event). */
  async getView(billId: string): Promise<TableBillView> {
    const bill = await this.bills.findById(billId);
    return this.buildView(bill, await this.tableOf(bill));
  }

  async setEqualSplit(billId: string, shareCount: number): Promise<TableBillView> {
    await withTransaction(this.pool, async (db) => {
      const bill = await this.bills.lockById(db, billId);
      const split = await this.splits.findByBill(billId, db);
      if (split?.frozenAt) throw new ConflictException("Shares are already being paid; the split can't change now");
      if (bill.posStatus === "closed") throw new ConflictException("This bill is closed");
      await this.splits.upsert(db, bill.tenantId, billId, shareCount);
    });
    this.events.emit(billId);
    return this.getView(billId);
  }

  async removeEqualSplit(billId: string): Promise<TableBillView> {
    await withTransaction(this.pool, async (db) => {
      await this.bills.lockById(db, billId);
      const split = await this.splits.findByBill(billId, db);
      if (split?.frozenAt) throw new ConflictException("Shares are already being paid; the split can't be removed");
      await this.splits.delete(db, billId);
    });
    this.events.emit(billId);
    return this.getView(billId);
  }

  private async tableOf(bill: BillRecord): Promise<TableContext> {
    const table = await this.tables.findContextByTableId(bill.tableId);
    if (!table) throw new NotFoundException("Table not found");
    return table;
  }

  private async buildView(bill: BillRecord, table: TableContext): Promise<TableBillView> {
    const [payments, split, paymentCurrencies] = await Promise.all([
      this.payments.listLiveForBill(bill.id),
      this.splits.findByBill(bill.id),
      this.paymentCurrencies(bill, table),
    ]);
    const state = computeBillState(bill, payments, split, new Date());
    const breakdown = billBreakdown(bill.items, bill.serviceChargeMinor, bill.totalMinor);

    return {
      bill: {
        id: bill.id,
        tenantName: table.tenantName,
        venueName: table.venueName,
        tableLabel: table.tableLabel,
        currency: bill.currency,
        status: state.status,
        items: bill.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          lineTotalMinor: state.lineTotals.get(item.id)!,
          state: state.itemStates.get(item.id)!,
        })),
        ...breakdown,
        paidMinor: state.paidMinor,
        reservedMinor: state.reservedMinor,
        remainingMinor: state.remainingMinor,
      },
      equalSplit: state.equalSplit && {
        shareCount: state.equalSplit.shareCount,
        frozen: state.equalSplit.frozen,
        shares: state.equalSplit.shareAmounts.map((amountMinor, index) => ({
          index,
          amountMinor,
          state: state.equalSplit!.shareStates[index],
        })),
      },
      modes: state.modes,
      paymentCurrencies,
      tipPercentOptions: table.tipPercentOptions,
      holdMinutes: this.config.paymentHoldMinutes,
    };
  }

  /** The bill currency, plus every extra currency the restaurant accepts and has a rate for. */
  private async paymentCurrencies(bill: BillRecord, table: TableContext): Promise<PaymentCurrencyOption[]> {
    const options: PaymentCurrencyOption[] = [{ currency: bill.currency, rate: null, rateEffectiveAt: null }];
    for (const currency of table.paymentCurrencies) {
      if (currency === bill.currency) continue;
      const rate = await this.rates.findCurrent(table.tenantId, bill.currency, currency);
      if (rate) options.push({ currency, rate: rate.rate, rateEffectiveAt: rate.effectiveAt.toISOString() });
    }
    return options;
  }
}
