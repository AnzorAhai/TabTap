import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { StaffGuard } from "./staff.guard";

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, StaffGuard],
  exports: [AuthService, StaffGuard],
})
export class AuthModule {}
