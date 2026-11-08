import { Global, Module } from "@nestjs/common";
import { BillEventsService } from "../events/bill-events.service";
import { BcvRateService } from "../rates/bcv-rate.service";
import { BillsRepository } from "./bills.repository";
import { DemoPosRepository } from "./demo-pos.repository";
import { EqualSplitsRepository } from "./equal-splits.repository";
import { ExchangeRatesRepository } from "./exchange-rates.repository";
import { PaymentMethodsRepository } from "./payment-methods.repository";
import { PaymentsRepository } from "./payments.repository";
import { PosSyncRepository } from "./pos-sync.repository";
import { ReceiptsRepository } from "./receipts.repository";
import { SessionsRepository } from "./sessions.repository";
import { TablesRepository } from "./tables.repository";
import { TenantsRepository } from "./tenants.repository";
import { UsersRepository } from "./users.repository";

const providers = [
  TablesRepository,
  BillsRepository,
  DemoPosRepository,
  EqualSplitsRepository,
  PaymentsRepository,
  PaymentMethodsRepository,
  ReceiptsRepository,
  ExchangeRatesRepository,
  PosSyncRepository,
  TenantsRepository,
  UsersRepository,
  SessionsRepository,
  BillEventsService,
  BcvRateService,
];

/** Repositories and the bill event bus, shared by every feature module. */
@Global()
@Module({ providers, exports: providers })
export class DataModule {}
