import { Module } from "@nestjs/common";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { RestaurantController } from "./restaurant.controller";
import { RestaurantService } from "./restaurant.service";
import { StaffService } from "./staff.service";

/** The admin panel's API: a restaurant's own management, and the platform section. */
@Module({
  controllers: [RestaurantController, PlatformController],
  providers: [RestaurantService, StaffService, PlatformService],
})
export class AdminModule {}
