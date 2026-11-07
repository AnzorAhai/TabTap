import { Module } from "@nestjs/common";
import { PaymentsIntegrationModule } from "../integrations/payments/payments-integration.module";
import { PosModule } from "../integrations/pos/pos.module";
import { BackgroundJobsService } from "./background-jobs.service";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PosSyncService } from "./pos-sync.service";

@Module({
  imports: [PaymentsIntegrationModule, PosModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PosSyncService, BackgroundJobsService],
  exports: [PaymentsService, PosSyncService, BackgroundJobsService],
})
export class PaymentsModule {}
