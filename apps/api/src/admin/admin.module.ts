import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminTokenGuard } from "./admin-token.guard";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminTokenGuard],
})
export class AdminModule {}
