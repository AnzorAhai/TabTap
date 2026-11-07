import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Tighter than the global limit: creating payments is the most abusable endpoint.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(dto);
  }

  @Get(":paymentId")
  get(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.paymentsService.getPayment(paymentId);
  }

  @Get(":paymentId/receipt")
  getReceipt(@Param("paymentId", ParseUUIDPipe) paymentId: string) {
    return this.paymentsService.getReceipt(paymentId);
  }
}
