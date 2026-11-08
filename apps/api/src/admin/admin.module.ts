import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { PaymentAdminService } from "./payment-admin.service";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { RestaurantController } from "./restaurant.controller";
import { RestaurantService } from "./restaurant.service";
import { StaffService } from "./staff.service";

/** The admin panel's API: a restaurant's own management, and the platform section. */
@Module({
  imports: [PaymentsModule],
  controllers: [RestaurantController, PlatformController],
  providers: [RestaurantService, StaffService, PlatformService, PaymentAdminService],
})
export class AdminModule {}
