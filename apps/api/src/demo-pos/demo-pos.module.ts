import { Module } from "@nestjs/common";
import { PosModule } from "../integrations/pos/pos.module";
import { DemoPosController } from "./demo-pos.controller";
import { DemoPosService } from "./demo-pos.service";

@Module({
  imports: [PosModule],
  controllers: [DemoPosController],
  providers: [DemoPosService],
})
export class DemoPosModule {}
