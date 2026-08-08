import { Module } from "@nestjs/common";
import { BillsModule } from "../bills/bills.module";
import { PaymentsModule } from "../payments/payments.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [BillsModule, PaymentsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
