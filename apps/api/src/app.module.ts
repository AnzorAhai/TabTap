import { Module } from "@nestjs/common";
import { BillsModule } from "./bills/bills.module";
import { PaymentsModule } from "./payments/payments.module";

@Module({
  imports: [BillsModule, PaymentsModule],
})
export class AppModule {}
