import { Module } from "@nestjs/common";
import { PaymentsIntegrationModule } from "../integrations/payments/payments-integration.module";
import { PosModule } from "../integrations/pos/pos.module";
import { BillsModule } from "../bills/bills.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [PaymentsIntegrationModule, PosModule, BillsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
