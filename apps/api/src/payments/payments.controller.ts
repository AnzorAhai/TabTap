import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(dto);
  }

  @Get(":paymentId")
  get(@Param("paymentId") paymentId: string) {
    return this.paymentsService.getPayment(paymentId);
  }

  @Get(":paymentId/receipt")
  getReceipt(@Param("paymentId") paymentId: string) {
    return this.paymentsService.getReceipt(paymentId);
  }
}
