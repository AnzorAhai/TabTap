import { BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  basisPointsOf,
  convertMinor,
  percentOf,
  PaymentStatus,
  type CreatePaymentRequest,
  type PaymentView,
  type ReceiptView,
} from "@tabtap/shared";
import { Pool } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { BillsRepository } from "../data/bills.repository";
import { EqualSplitsRepository } from "../data/equal-splits.repository";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { PaymentsRepository } from "../data/payments.repository";
import { errorText } from "../common/error-text";
import { PosSyncRepository } from "../data/pos-sync.repository";
import { ReceiptsRepository } from "../data/receipts.repository";
import type { PaymentRecord } from "../data/records";
import { TablesRepository } from "../data/tables.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction } from "../database/transaction";
import { computeBillState } from "../domain/bill-state";
import { planPayment } from "../domain/payment-plan";
import { BillEventsService } from "../events/bill-events.service";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPaymentStatus,
} from "../integrations/payments/payment-provider.interface";

/**
 * Payment lifecycle:
 *   create → pending (holds its items/shares) → succeeded | failed | canceled | expired
 * The pending row is written and committed before the gateway is called, so a crash
 * mid-way never leaves money taken without a record. Settlement updates the bill,
 * writes the receipt and queues the POS update in one transaction.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly tables: TablesRepository,
    private readonly bills: BillsRepository,
    private readonly splits: EqualSplitsRepository,
    private readonly payments: PaymentsRepository,
    private readonly receipts: ReceiptsRepository,
    private readonly rates: ExchangeRatesRepository,
    private readonly posSync: PosSyncRepository,
    private readonly events: BillEventsService,
  ) {}

  /**
   * Starts a payment. Repeating the call with the same idempotency key returns the
   * payment created the first time instead of charging again.
   */
  async createPayment(billId: string, request: CreatePaymentRequest, idempotencyKey: string): Promise<PaymentView> {
    const { payment, isNew } = await withTransaction(this.pool, async (db) => {
      // Every payment decision on a bill is serialized by this row lock.
      const bill = await this.bills.lockById(db, billId);
      const existing = await this.payments.findByIdempotencyKey(db, billId, idempotencyKey);
      if (existing) return { payment: existing, isNew: false };

      const table = await this.tables.findContextByTableId(bill.tableId, db);
      if (!table) throw new NotFoundException("Table not found");
      // One connection runs one query at a time, so these stay sequential.
      const live = await this.payments.listLiveForBill(billId, db);
      const split = await this.splits.findByBill(billId, db);
      const now = new Date();
      const state = computeBillState(bill, live, split, now);
      const plan = planPayment(bill, state, request);
      if (plan.freezeSplitAt !== null) await this.splits.freeze(db, billId, plan.freezeSplitAt);

      const tipMinor = percentOf(plan.amountMinor, request.tipPercent ?? 0);
      const chargeCurrency = request.currency.toUpperCase();
      let chargeAmountMinor = plan.amountMinor + tipMinor;
      let exchangeRate: string | null = null;
      if (chargeCurrency !== bill.currency) {
        if (!table.paymentCurrencies.includes(chargeCurrency)) {
          throw new ConflictException(`This restaurant doesn't accept payments in ${chargeCurrency}`);
        }
        const rate = await this.rates.findCurrent(bill.tenantId, bill.currency, chargeCurrency, db);
        if (!rate) throw new ConflictException(`No exchange rate set for ${bill.currency} → ${chargeCurrency}`);
        exchangeRate = rate.rate;
        chargeAmountMinor = convertMinor(chargeAmountMinor, bill.currency, chargeCurrency, rate.rate);
      }

      const created = await this.payments.insert(db, {
        tenantId: bill.tenantId,
        billId,
        mode: plan.mode,
        status: PaymentStatus.PENDING,
        itemIds: plan.itemIds,
        shareIndices: plan.shareIndices,
        amountMinor: plan.amountMinor,
        tipMinor,
        platformFeeMinor: basisPointsOf(plan.amountMinor, table.platformFeeBps),
        currency: bill.currency,
        chargeCurrency,
        chargeAmountMinor,
        exchangeRate,
        provider: this.provider.type,
        idempotencyKey,
        expiresAt: new Date(now.getTime() + this.config.paymentHoldMinutes * 60_000),
      });
      return { payment: created, isNew: true };
    });

    if (!isNew) return toView(payment);
    this.events.emit(billId);

    let intent;
    try {
      intent = await this.provider.createIntent({
        paymentId: payment.id,
        amountMinor: payment.chargeAmountMinor,
        currency: payment.chargeCurrency,
        description: `TabTap bill ${billId}`,
      });
    } catch (err) {
      this.logger.error(`Provider failed to start payment ${payment.id}`, err instanceof Error ? err.stack : err);
      await this.fail(payment.id, "provider_error");
      throw new BadGatewayException("The payment provider is unavailable; nothing was charged. Please try again.");
    }
    await this.payments.setProviderRef(payment.id, intent.providerRef);
    return this.applyProviderStatus(payment.id, intent.status, intent.failureReason);
  }

  /** Current state of a payment; asks the gateway if it is still pending (webhook fallback). */
  async getPayment(paymentId: string): Promise<PaymentView> {
    const payment = await this.payments.findById(paymentId);
    if (payment.status !== PaymentStatus.PENDING || !payment.providerRef) return toView(payment);
    try {
      const status = await this.provider.getStatus(payment.providerRef);
      return await this.applyProviderStatus(paymentId, status);
    } catch (err) {
      this.logger.warn(`Status check for payment ${paymentId} failed: ${errorText(err)}`);
      return toView(payment);
    }
  }

  /** The guest backed out: release the hold. */
  async cancel(paymentId: string): Promise<PaymentView> {
    const payment = await this.payments.finishPending(paymentId, PaymentStatus.CANCELED, "canceled_by_guest");
    if (!payment) {
      const current = await this.payments.findById(paymentId);
      throw new ConflictException(`This payment is already ${current.status}`);
    }
    this.events.emit(payment.billId);
    await this.cancelAtProvider(payment);
    return toView(payment);
  }

  /** Releases every hold that ran out. Returns how many payments expired. */
  async expireDue(now = new Date()): Promise<number> {
    const expired = await this.payments.expireDue(now);
    for (const billId of new Set(expired.map((p) => p.billId))) this.events.emit(billId);
    for (const payment of expired) await this.cancelAtProvider(payment);
    if (expired.length > 0) this.logger.log(`Expired ${expired.length} pending payment(s)`);
    return expired.length;
  }

  /** Mock gateway only: decide the outcome of a pending payment, like a bank confirmation would. */
  async mockConfirm(paymentId: string, outcome: "succeeded" | "failed"): Promise<PaymentView> {
    if (this.provider.type !== "mock") throw new NotFoundException();
    await this.payments.findById(paymentId);
    return this.applyProviderStatus(paymentId, outcome, outcome === "failed" ? "declined" : undefined);
  }

  /** Gateway webhook: verify, find the payment, apply the outcome. */
  async handleWebhook(
    providerType: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    if (providerType !== this.provider.type) throw new NotFoundException();
    const result = await this.provider.parseWebhook(rawBody, headers);
    if (!result) return;
    const payment = await this.payments.findByProviderRef(this.provider.type, result.providerRef);
    if (!payment) {
      this.logger.warn(`Webhook for unknown ${providerType} payment ${result.providerRef}`);
      return;
    }
    await this.applyProviderStatus(payment.id, result.status, result.failureReason);
  }

  async getReceipt(paymentId: string): Promise<ReceiptView> {
    return this.receipts.getViewByPaymentId(paymentId);
  }

  private async applyProviderStatus(
    paymentId: string,
    status: ProviderPaymentStatus,
    failureReason?: string,
  ): Promise<PaymentView> {
    if (status === "succeeded") return this.settle(paymentId);
    if (status === "failed") return this.fail(paymentId, failureReason ?? "declined");
    return toView(await this.payments.findById(paymentId));
  }

  /**
   * Records that the money arrived. Idempotent. Also accepted for a payment whose
   * hold already ended: the money is real, so it is recorded (and logged for review)
   * rather than lost.
   */
  async settle(paymentId: string): Promise<PaymentView> {
    const { payment, changed } = await withTransaction(this.pool, async (db) => {
      const { billId } = await this.payments.findById(paymentId, db);
      await this.bills.lockById(db, billId); // same lock order as createPayment: bill, then payment
      const current = await this.payments.lockById(db, paymentId);
      if (current.status === PaymentStatus.SUCCEEDED || current.status === PaymentStatus.REFUNDED) {
        return { payment: current, changed: false };
      }
      if (current.status !== PaymentStatus.PENDING) {
        this.logger.warn(`Payment ${paymentId} succeeded after it was ${current.status}; recording it anyway`);
      }
      const settled = await this.payments.markSucceeded(db, paymentId);
      await this.bills.addPaid(db, billId, settled.amountMinor);
      await this.receipts.createForPayment(db, settled.tenantId, paymentId);
      await this.posSync.enqueueMarkPaid(db, settled.tenantId, billId, paymentId);
      return { payment: settled, changed: true };
    });
    if (changed) this.events.emit(payment.billId);
    return toView(payment);
  }

  async fail(paymentId: string, reason: string): Promise<PaymentView> {
    const failed = await this.payments.finishPending(paymentId, PaymentStatus.FAILED, reason);
    if (failed) {
      this.events.emit(failed.billId);
      return toView(failed);
    }
    return toView(await this.payments.findById(paymentId));
  }

  private async cancelAtProvider(payment: PaymentRecord): Promise<void> {
    if (!payment.providerRef) return;
    try {
      await this.provider.cancel(payment.providerRef);
    } catch (err) {
      this.logger.warn(`Couldn't cancel payment ${payment.id} at the provider: ${errorText(err)}`);
    }
  }
}

export function toView(p: PaymentRecord): PaymentView {
  return {
    id: p.id,
    billId: p.billId,
    mode: p.mode,
    status: p.status,
    amountMinor: p.amountMinor,
    tipMinor: p.tipMinor,
    currency: p.currency,
    chargeAmountMinor: p.chargeAmountMinor,
    chargeCurrency: p.chargeCurrency,
    exchangeRate: p.exchangeRate,
    itemIds: p.itemIds,
    shareIndices: p.shareIndices,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    settledAt: p.settledAt?.toISOString() ?? null,
    failureReason: p.failureReason,
  };
}
