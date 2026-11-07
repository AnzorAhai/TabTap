import { Inject, Injectable } from "@nestjs/common";
import type { AdminPaymentView, AdminTableView, ExchangeRateView } from "@tabtap/shared";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { PaymentsRepository } from "../data/payments.repository";
import type { ExchangeRateRecord } from "../data/records";
import { TablesRepository } from "../data/tables.repository";

// Single-tenant MVP: admin always looks at the seeded demo tenant.
// Real tenant resolution (from an authenticated session) lands with Phase 2 multi-tenancy.
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

@Injectable()
export class AdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tables: TablesRepository,
    private readonly payments: PaymentsRepository,
    private readonly rates: ExchangeRatesRepository,
  ) {}

  async listTables(): Promise<AdminTableView[]> {
    const tables = await this.tables.listByTenant(DEMO_TENANT_ID);
    return tables.map((table) => ({
      id: table.tableId,
      label: table.tableLabel,
      qrToken: table.qrToken,
      isActive: table.isActive,
      guestUrl: `${this.config.guestAppUrl}/?table=${encodeURIComponent(table.qrToken)}`,
    }));
  }

  async listPayments(): Promise<AdminPaymentView[]> {
    return this.payments.listByTenant(DEMO_TENANT_ID);
  }

  async listExchangeRates(): Promise<ExchangeRateView[]> {
    return (await this.rates.listCurrent(DEMO_TENANT_ID)).map(toRateView);
  }

  async setExchangeRate(baseCurrency: string, quoteCurrency: string, rate: string): Promise<ExchangeRateView> {
    return toRateView(await this.rates.insert(DEMO_TENANT_ID, baseCurrency, quoteCurrency, rate, "manual"));
  }
}

function toRateView(r: ExchangeRateRecord): ExchangeRateView {
  return {
    baseCurrency: r.baseCurrency,
    quoteCurrency: r.quoteCurrency,
    rate: r.rate,
    source: r.source,
    effectiveAt: r.effectiveAt.toISOString(),
  };
}
