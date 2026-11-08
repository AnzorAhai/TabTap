import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  basisPointsOf,
  convertMinor,
  PAYMENT_METHODS,
  percentOf,
  PaymentStatus,
  type CreatePaymentRequest,
  type PaymentView,
  type ReceiptView,
  type SubmitProofRequest,
} from "@tabtap/shared";
import { Pool } from "pg";
import { errorText } from "../common/error-text";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { BillsRepository } from "../data/bills.repository";
import { EqualSplitsRepository } from "../data/equal-splits.repository";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { PaymentMethodsRepository } from "../data/payment-methods.repository";
import { PaymentsRepository } from "../data/payments.repository";
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

/** Payments confirmed by staff or by a reported reference, not by a gateway. */
const OFFLINE_PROVIDER = "offline";

/**
 * Payment lifecycle:
 *   create → pending (holds its items/shares) → succeeded | failed | canceled | expired
 * The pending row is written and committed before anything else happens, so a crash
 * mid-way never leaves money taken without a record. Settlement updates the bill,
 * writes the receipt and queues the POS update in one transaction.
 *
 * How a pending payment gets confirmed depends on its method:
 *   gateway (card)                   — the payment provider (webhook / status check)
 *   proof (Pago Móvil, Zelle, …)     — the guest reports a reference; staff confirm it,
 *                                      or the demo simulator does
 *   staff (cash)                     — the waiter confirms receiving it
 * Money goes straight to the restaurant; TabTap only records the platform fee.
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
    private readonly methods: PaymentMethodsRepository,
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
      const method = await this.methods.find(bill.tenantId, request.method, db);
      if (!method?.enabled) throw new ConflictException("This restaurant doesn't accept this payment method");
      const { flow } = PAYMENT_METHODS[request.method];
      const chargeCurrency =
        PAYMENT_METHODS[request.method].currency === "bill" ? bill.currency : PAYMENT_METHODS[request.method].currency;

      // One connection runs one query at a time, so these stay sequential.
      const live = await this.payments.listLiveForBill(billId, db);
      const split = await this.splits.findByBill(billId, db);
      const now = new Date();
      const state = computeBillState(bill, live, split, now);
      const plan = planPayment(bill, state, request);
      if (plan.freezeSplitAt !== null) await this.splits.freeze(db, billId, plan.freezeSplitAt);

      const tipMinor = percentOf(plan.amountMinor, request.tipPercent ?? 0);
      let converted = plan.amountMinor + tipMinor;
      let exchangeRate: string | null = null;
      if (chargeCurrency !== bill.currency) {
        const rate = await this.rates.findCurrent(bill.tenantId, bill.currency, chargeCurrency, db);
        if (!rate) throw new ConflictException(`No exchange rate set for ${bill.currency} → ${chargeCurrency}`);
        exchangeRate = rate.rate;
        converted = convertMinor(converted, bill.currency, chargeCurrency, rate.rate);
      }
      const surchargeMinor = basisPointsOf(converted, method.surchargeBps);
      const holdMinutes = flow === "gateway" ? this.config.paymentHoldMinutes : this.config.offlineHoldMinutes;

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
        chargeAmountMinor: converted + surchargeMinor,
        exchangeRate,
        method: request.method,
        surchargeBps: method.surchargeBps,
        surchargeMinor,
        provider: flow === "gateway" ? this.provider.type : OFFLINE_PROVIDER,
        idempotencyKey,
        expiresAt: new Date(now.getTime() + holdMinutes * 60_000),
      });
      return { payment: created, isNew: true };
    });

    if (!isNew) return this.view(payment);
    this.events.emit(billId);
    // Offline methods wait for the guest's reference or the waiter; nothing to call.
    if (payment.provider === OFFLINE_PROVIDER) return this.view(payment);

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
    if (payment.status !== PaymentStatus.PENDING || !payment.providerRef || payment.provider === OFFLINE_PROVIDER) {
      return this.view(payment);
    }
    try {
      const status = await this.provider.getStatus(payment.providerRef);
      return await this.applyProviderStatus(paymentId, status);
    } catch (err) {
      this.logger.warn(`Status check for payment ${paymentId} failed: ${errorText(err)}`);
      return this.view(payment);
    }
  }

  /** The guest reports having paid outside TabTap (Pago Móvil reference, Zelle confirmation, …). */
  async submitProof(paymentId: string, proof: SubmitProofRequest): Promise<PaymentView> {
    const payment = await this.payments.findById(paymentId);
    if (PAYMENT_METHODS[payment.method].flow !== "proof") {
      throw new BadRequestException("This payment method doesn't take a reference");
    }
    const clean = Object.fromEntries(
      Object.entries(proof)
        .filter(([, v]) => typeof v === "string" && v.trim() !== "")
        .map(([k, v]) => [k, (v as string).trim()]),
    );
    const updated = await this.payments.submitProof(paymentId, clean);
    if (!updated) throw new ConflictException(`This payment is already ${payment.status}`);
    this.events.emit(updated.billId);
    return this.view(updated);
  }

  /** A staff member saw the money arrive (cash in hand, transfer in the bank app). */
  async confirmByStaff(tenantId: string, paymentId: string, userId: string): Promise<PaymentView> {
    const payment = await this.offlinePaymentOf(tenantId, paymentId);
    if (payment.status === PaymentStatus.SUCCEEDED) return this.view(payment);
    if (payment.status === PaymentStatus.REFUNDED) throw new ConflictException("This payment was refunded");
    await this.payments.setReviewedBy(this.pool, paymentId, userId);
    return this.settle(paymentId);
  }

  async rejectByStaff(tenantId: string, paymentId: string, userId: string, reason?: string): Promise<PaymentView> {
    const payment = await this.offlinePaymentOf(tenantId, paymentId);
    if (payment.status !== PaymentStatus.PENDING)
      throw new ConflictException(`This payment is already ${payment.status}`);
    await this.payments.setReviewedBy(this.pool, paymentId, userId);
    return this.fail(paymentId, `rejected_by_staff${reason ? `: ${reason.trim().slice(0, 200)}` : ""}`);
  }

  /**
   * Demo stand-in for a bank's transfer check: references ending in "0000" are "not
   * found", anything else is confirmed. Real bank APIs replace this per restaurant.
   */
  async runSimulatedChecks(): Promise<number> {
    const due = await this.payments.listDueForSimulatedCheck(this.config.simulatedCheckSeconds);
    for (const payment of due) {
      const reference = payment.proof?.reference ?? "";
      if (/0000$/.test(reference)) await this.fail(payment.id, "reference_not_found");
      else await this.settle(payment.id);
    }
    return due.length;
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
    return this.view(payment);
  }

  /** Releases every hold that ran out. Returns how many payments expired. */
  async expireDue(now = new Date()): Promise<number> {
    const expired = await this.payments.expireDue(now);
    for (const billId of new Set(expired.map((p) => p.billId))) this.events.emit(billId);
    for (const payment of expired) await this.cancelAtProvider(payment);
    if (expired.length > 0) this.logger.log(`Expired ${expired.length} pending payment(s)`);
    return expired.length;
  }

  /** Mock gateway only: decide the outcome of a pending card payment, like a bank confirmation would. */
  async mockConfirm(paymentId: string, outcome: "succeeded" | "failed"): Promise<PaymentView> {
    const payment = await this.payments.findById(paymentId);
    if (this.provider.type !== "mock" || payment.provider !== "mock") throw new NotFoundException();
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
    return this.view(await this.payments.findById(paymentId));
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
    return this.view(payment);
  }

  async fail(paymentId: string, reason: string): Promise<PaymentView> {
    const failed = await this.payments.finishPending(paymentId, PaymentStatus.FAILED, reason);
    if (failed) {
      this.events.emit(failed.billId);
      return this.view(failed);
    }
    return this.view(await this.payments.findById(paymentId));
  }

  private async offlinePaymentOf(tenantId: string, paymentId: string): Promise<PaymentRecord> {
    const payment = await this.payments.findById(paymentId);
    // Never act on another restaurant's payment, and don't reveal that it exists.
    if (payment.tenantId !== tenantId) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (payment.provider !== OFFLINE_PROVIDER) {
      throw new ConflictException("Card payments are confirmed by the payment provider");
    }
    return payment;
  }

  private async cancelAtProvider(payment: PaymentRecord): Promise<void> {
    if (!payment.providerRef || payment.provider === OFFLINE_PROVIDER) return;
    try {
      await this.provider.cancel(payment.providerRef);
    } catch (err) {
      this.logger.warn(`Couldn't cancel payment ${payment.id} at the provider: ${errorText(err)}`);
    }
  }

  /** The guest-facing view, with where to pay for offline methods. */
  private async view(p: PaymentRecord): Promise<PaymentView> {
    const flow = PAYMENT_METHODS[p.method].flow;
    let payTo: Record<string, string> | null = null;
    if (flow !== "gateway") {
      const method = await this.methods.find(p.tenantId, p.method);
      // "verification" is internal configuration, not a payee detail.
      payTo = method ? Object.fromEntries(Object.entries(method.details).filter(([k]) => k !== "verification")) : {};
    }
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
      surchargeMinor: p.surchargeMinor,
      exchangeRate: p.exchangeRate,
      method: p.method,
      flow,
      payTo,
      proofSubmitted: p.proofSubmittedAt !== null,
      itemIds: p.itemIds,
      shareIndices: p.shareIndices,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      settledAt: p.settledAt?.toISOString() ?? null,
      failureReason: p.failureReason,
    };
  }
}
