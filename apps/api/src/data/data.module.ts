import { Global, Module } from "@nestjs/common";
import { BillEventsService } from "../events/bill-events.service";
import { BillsRepository } from "./bills.repository";
import { EqualSplitsRepository } from "./equal-splits.repository";
import { ExchangeRatesRepository } from "./exchange-rates.repository";
import { PaymentsRepository } from "./payments.repository";
import { PosSyncRepository } from "./pos-sync.repository";
import { ReceiptsRepository } from "./receipts.repository";
import { TablesRepository } from "./tables.repository";

const providers = [
  TablesRepository,
  BillsRepository,
  EqualSplitsRepository,
  PaymentsRepository,
  ReceiptsRepository,
  ExchangeRatesRepository,
  PosSyncRepository,
  BillEventsService,
];

/** Repositories and the bill event bus, shared by every feature module. */
@Global()
@Module({ providers, exports: providers })
export class DataModule {}
