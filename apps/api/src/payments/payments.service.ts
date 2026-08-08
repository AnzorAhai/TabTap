import { randomUUID } from "crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Payment, PaymentStatus } from "@tabtap/shared";
import { PAYMENT_PROVIDER, PaymentProvider } from "../integrations/payments/payment-provider.interface";
import { POS_CONNECTOR, POSConnector } from "../integrations/pos/pos-connector.interface";
import { BillsService } from "../bills/bills.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";

const PLATFORM_FEE_RATE = 0.015;

@Injectable()
export class PaymentsService {
  private readonly payments = new Map<string, Payment>();

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(POS_CONNECTOR) private readonly posConnector: POSConnector,
    private readonly billsService: BillsService,
  ) {}

  async createPayment(dto: CreatePaymentDto): Promise<Payment> {
    const totalMinor = dto.amountMinor + (dto.tipMinor ?? 0);
    const intent = await this.paymentProvider.createPaymentIntent({
      amountMinor: totalMinor,
      currency: dto.currency,
      metadata: { billId: dto.billId, participantId: dto.participantId ?? "" },
    });

    const payment: Payment = {
      id: randomUUID(),
      tenantId: "demo-tenant",
      billId: dto.billId,
      splitParticipantId: dto.participantId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      tipMinor: dto.tipMinor ?? 0,
      platformFeeMinor: Math.round(dto.amountMinor * PLATFORM_FEE_RATE),
      status: intent.status,
      providerRef: intent.providerRef,
      createdAt: new Date().toISOString(),
    };
    this.payments.set(payment.id, payment);

    if (payment.status === PaymentStatus.SUCCEEDED) {
      await this.settlePayment(payment, dto.splitId);
    }

    return payment;
  }

  async getPayment(paymentId: string): Promise<Payment> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    return payment;
  }

  private async settlePayment(payment: Payment, splitId?: string): Promise<void> {
    if (splitId && payment.splitParticipantId) {
      await this.billsService.markParticipantPaid(splitId, payment.splitParticipantId, payment.amountMinor);
    }
    if (this.posConnector.capabilities.supportsMarkPaid) {
      await this.posConnector.markPaid(payment.billId, {
        amountMinor: payment.amountMinor,
        paymentId: payment.id,
      });
    }
  }
}
