import { randomUUID } from "crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Bill, Payment, PaymentStatus, ReceiptView } from "@tabtap/shared";
import { PAYMENT_PROVIDER, PaymentProvider } from "../integrations/payments/payment-provider.interface";
import { POS_CONNECTOR, POSConnector } from "../integrations/pos/pos-connector.interface";
import { BillsService } from "../bills/bills.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { PaymentsRepository } from "./payments.repository";
import { ReceiptsRepository } from "./receipts.repository";

const PLATFORM_FEE_RATE = 0.015;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(POS_CONNECTOR) private readonly posConnector: POSConnector,
    private readonly billsService: BillsService,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly receiptsRepository: ReceiptsRepository,
  ) {}

  async createPayment(dto: CreatePaymentDto): Promise<Payment> {
    const bill = await this.billsService.getBill(dto.billId);
    const totalMinor = dto.amountMinor + (dto.tipMinor ?? 0);
    const intent = await this.paymentProvider.createPaymentIntent({
      amountMinor: totalMinor,
      currency: dto.currency,
      metadata: { billId: dto.billId, participantId: dto.participantId ?? "" },
    });

    const payment = await this.paymentsRepository.create({
      id: randomUUID(),
      tenantId: bill.tenantId,
      billId: dto.billId,
      splitParticipantId: dto.participantId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      tipMinor: dto.tipMinor ?? 0,
      platformFeeMinor: Math.round(dto.amountMinor * PLATFORM_FEE_RATE),
      status: intent.status,
      providerRef: intent.providerRef,
    });

    if (payment.status === PaymentStatus.SUCCEEDED) {
      await this.settlePayment(bill, payment, dto.splitId);
    }

    return payment;
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return this.paymentsRepository.findById(paymentId);
  }

  async getReceipt(paymentId: string): Promise<ReceiptView> {
    return this.receiptsRepository.getViewByPaymentId(paymentId);
  }

  private async settlePayment(bill: Bill, payment: Payment, splitId?: string): Promise<void> {
    await this.receiptsRepository.createForPayment(payment.id, payment.tenantId);
    if (splitId && payment.splitParticipantId) {
      await this.billsService.markParticipantPaid(splitId, payment.splitParticipantId, payment.amountMinor);
    }
    if (this.posConnector.capabilities.supportsMarkPaid) {
      await this.posConnector.markPaid(bill.externalPosId, {
        amountMinor: payment.amountMinor,
        paymentId: payment.id,
      });
      await this.billsService.refreshBillFromPos(bill);
    }
  }
}
