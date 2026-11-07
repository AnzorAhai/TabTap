import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  type RawBodyRequest,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { PaymentView, ReceiptView } from "@tabtap/shared";
import type { Request } from "express";
import { CreatePaymentDto, MockConfirmDto } from "./dto/create-payment.dto";
import { PaymentsService } from "./payments.service";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Starts a payment. Requires an `Idempotency-Key` header (e.g. a UUID generated
   * once per "Pay" tap): retries with the same key return the same payment.
   */
  // Tighter than the global limit: creating payments is the most abusable endpoint.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("bills/:billId/payments")
  create(
    @Param("billId", ParseUUIDPipe) billId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentView> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException("Idempotency-Key header is required (8-100 letters, digits, - or _)");
    }
    return this.payments.createPayment(billId, dto, idempotencyKey);
  }

  @Get("payments/:paymentId")
  get(@Param("paymentId", ParseUUIDPipe) paymentId: string): Promise<PaymentView> {
    return this.payments.getPayment(paymentId);
  }

  @Post("payments/:paymentId/cancel")
  @HttpCode(200)
  cancel(@Param("paymentId", ParseUUIDPipe) paymentId: string): Promise<PaymentView> {
    return this.payments.cancel(paymentId);
  }

  /** Mock gateway only (404 otherwise): confirm or decline a pending payment. */
  @Post("payments/:paymentId/mock-confirm")
  @HttpCode(200)
  mockConfirm(@Param("paymentId", ParseUUIDPipe) paymentId: string, @Body() dto: MockConfirmDto): Promise<PaymentView> {
    return this.payments.mockConfirm(paymentId, dto.outcome);
  }

  @Get("payments/:paymentId/receipt")
  getReceipt(@Param("paymentId", ParseUUIDPipe) paymentId: string): Promise<ReceiptView> {
    return this.payments.getReceipt(paymentId);
  }

  /** Gateway callbacks. Verified by the provider adapter against the raw request body. */
  @SkipThrottle()
  @Post("payments/webhooks/:provider")
  @HttpCode(200)
  async webhook(@Param("provider") provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw new BadRequestException("Empty webhook body");
    try {
      await this.payments.handleWebhook(provider, req.rawBody, req.headers);
    } catch (err) {
      if (err instanceof Error && /signature/i.test(err.message)) throw new BadRequestException("Invalid signature");
      throw err;
    }
    return { received: true };
  }
}
