import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { BillsModule } from "./bills/bills.module";
import { PaymentsModule } from "./payments/payments.module";
import { AdminModule } from "./admin/admin.module";

@Module({
  imports: [DatabaseModule, BillsModule, PaymentsModule, AdminModule],
})
export class AppModule {}
