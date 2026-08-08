import { Module } from "@nestjs/common";
import { PosModule } from "../integrations/pos/pos.module";
import { TablesRepository } from "../tables/tables.repository";
import { BillsController } from "./bills.controller";
import { BillsService } from "./bills.service";
import { BillsRepository } from "./bills.repository";
import { SplitsRepository } from "./splits.repository";

@Module({
  imports: [PosModule],
  controllers: [BillsController],
  providers: [BillsService, BillsRepository, SplitsRepository, TablesRepository],
  exports: [BillsService, TablesRepository],
})
export class BillsModule {}
