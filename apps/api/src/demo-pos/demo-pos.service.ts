import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { billBreakdown, PaymentStatus, type DemoPosOrderView, type DemoPosView } from "@tabtap/shared";
import { Pool } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { BillsRepository } from "../data/bills.repository";
import { DemoPosRepository, type DemoOrder } from "../data/demo-pos.repository";
import { EqualSplitsRepository } from "../data/equal-splits.repository";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { PaymentsRepository } from "../data/payments.repository";
import type { BillRecord, TableContext } from "../data/records";
import { TablesRepository } from "../data/tables.repository";
import { TenantsRepository } from "../data/tenants.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction } from "../database/transaction";
import { computeBillState } from "../domain/bill-state";
import { BillEventsService } from "../events/bill-events.service";
import { POS_CONNECTOR, type POSConnector } from "../integrations/pos/pos-connector.interface";

/**
 * The waiter's screen of the demo POS. Every change to an order is copied to TabTap's
 * bill right away, as a real POS would report it, so guests and the admin panel see it.
 */
@Injectable()
export class DemoPosService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(POS_CONNECTOR) private readonly pos: POSConnector,
    private readonly orders: DemoPosRepository,
    private readonly tenants: TenantsRepository,
    private readonly tables: TablesRepository,
    private readonly bills: BillsRepository,
    private readonly payments: PaymentsRepository,
    private readonly splits: EqualSplitsRepository,
    private readonly rates: ExchangeRatesRepository,
    private readonly events: BillEventsService,
  ) {}

  async view(tenantId: string): Promise<DemoPosView> {
    const tenant = await this.enabledTenant(tenantId);
    const [menu, tables, open, rates] = await Promise.all([
      this.orders.listMenu(tenantId),
      this.tables.listByTenant(tenantId),
      this.orders.listOpen(tenantId),
      this.rates.listCurrent(tenantId),
    ]);
    const rate = rates.find((r) => r.baseCurrency === tenant.defaultCurrency) ?? null;
    const orderOf = new Map(open.map((order) => [order.tableId, order]));
    return {
      currency: tenant.defaultCurrency,
      rate: rate && { currency: rate.quoteCurrency, value: rate.rate },
      menu,
      tables: await Promise.all(
        tables
          .filter((table) => table.isActive)
          .map(async (table) => {
            const order = orderOf.get(table.tableId);
            return {
              tableId: table.tableId,
              label: table.tableLabel,
              guestUrl: `${this.config.guestAppUrl}/?table=${encodeURIComponent(table.qrToken)}`,
              order: order ? await this.orderView(table, order) : null,
            };
          }),
      ),
    };
  }

  /** Adds one portion, opening the table's order if this is the first. */
  async addLine(tenantId: string, tableId: string, menuItemId: string): Promise<DemoPosView> {
    await this.enabledTenant(tenantId);
    const table = await this.tables.findInTenant(tenantId, tableId);
    const item = await this.orders.findMenuItem(tenantId, menuItemId);
    await withTransaction(this.pool, async (db) => {
      const orderId = await this.orders.lockOrOpen(db, tenantId, tableId);
      await this.orders.addLine(db, tenantId, orderId, item.name, item.priceMinor);
    });
    await this.syncBill(table);
    return this.view(tenantId);
  }

  /** Corrects a mistake while nobody has started paying. Removing the last line cancels the order. */
  async removeLine(tenantId: string, tableId: string, lineId: string): Promise<DemoPosView> {
    await this.enabledTenant(tenantId);
    const table = await this.tables.findInTenant(tenantId, tableId);
    const billId = await withTransaction(this.pool, async (db) => {
      const orderId = await this.orders.lockOpen(db, tableId);
      if (!orderId) throw new NotFoundException("This table has no open order");
      const bill = await this.bills.findByPosId(tableId, orderId, db);
      if (bill) {
        await this.bills.lockById(db, bill.id); // no payment can start while this runs
        if ((await this.payments.listLiveForBill(bill.id, db)).length > 0) {
          throw new ConflictException("Payments have started on this bill; lines can't be removed");
        }
      }
      const left = await this.orders.removeLine(db, orderId, lineId);
      if (left === null) throw new NotFoundException("This order has no such line");
      if (left === 0) {
        await this.orders.close(db, orderId);
        if (bill) await this.bills.markClosed(db, bill.id);
      }
      return left === 0 ? (bill?.id ?? null) : undefined;
    });
    if (billId === undefined) await this.syncBill(table);
    else if (billId) this.events.emit(billId);
    return this.view(tenantId);
  }

  /** Clears the table for the next guests. Allowed with money still owed, like at a real register. */
  async closeTable(tenantId: string, tableId: string): Promise<DemoPosView> {
    await this.enabledTenant(tenantId);
    await this.tables.findInTenant(tenantId, tableId);
    const billId = await withTransaction(this.pool, async (db) => {
      const orderId = await this.orders.lockOpen(db, tableId);
      if (!orderId) throw new NotFoundException("This table has no open order");
      const bill = await this.bills.findByPosId(tableId, orderId, db);
      await this.orders.close(db, orderId);
      if (bill) await this.bills.markClosed(db, bill.id);
      return bill?.id ?? null;
    });
    if (billId) this.events.emit(billId);
    return this.view(tenantId);
  }

  /** Back to a clean restaurant between demos. Tables, QR codes, menu and settings stay. */
  async reset(tenantId: string): Promise<DemoPosView> {
    await this.enabledTenant(tenantId);
    const billIds = await withTransaction(this.pool, (db) => this.orders.wipe(db, tenantId));
    for (const billId of billIds) this.events.emit(billId);
    return this.view(tenantId);
  }

  /** Real restaurants never reach this screen, and above all never the reset. */
  private async enabledTenant(tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (this.config.posConnectorType !== "demo" || !tenant.isDemo) {
      throw new NotFoundException("The demo POS isn't enabled for this restaurant");
    }
    return tenant;
  }

  private async syncBill(table: TableContext): Promise<BillRecord | null> {
    const posBill = await this.pos.getOpenBill(table);
    if (!posBill) return null;
    const { bill } = await this.bills.upsertFromPos(table, posBill);
    this.events.emit(bill.id);
    return bill;
  }

  private async orderView(table: TableContext, order: DemoOrder): Promise<DemoPosOrderView | null> {
    const bill = (await this.bills.findByPosId(table.tableId, order.id)) ?? (await this.syncBill(table));
    if (!bill) return null;
    const [live, split] = await Promise.all([this.payments.listLiveForBill(bill.id), this.splits.findByBill(bill.id)]);
    const state = computeBillState(bill, live, split, new Date());
    const settled = live.filter((p) => p.status === PaymentStatus.SUCCEEDED);
    return {
      id: order.id,
      billId: bill.id,
      openedAt: order.openedAt.toISOString(),
      status: state.status,
      lines: order.lines.map((line) => ({
        id: line.id,
        name: line.name,
        priceMinor: line.priceMinor,
        state: state.itemStates.get(line.id) ?? "available",
      })),
      ...billBreakdown(bill.items, bill.serviceChargeMinor, bill.totalMinor),
      paidMinor: state.paidMinor,
      reservedMinor: state.reservedMinor,
      remainingMinor: state.remainingMinor,
      tipMinor: settled.reduce((sum, p) => sum + p.tipMinor, 0),
      payments: [...live].reverse().map((p) => ({
        id: p.id,
        status: p.status,
        method: p.method,
        amountMinor: p.amountMinor,
        tipMinor: p.tipMinor,
        chargeAmountMinor: p.chargeAmountMinor,
        chargeCurrency: p.chargeCurrency,
      })),
    };
  }
}
