import { Inject, Injectable } from "@nestjs/common";
import type {
  AdminPaymentView,
  AdminTableView,
  ExchangeRateView,
  StaffRole,
  TenantSettingsView,
  VenueView,
} from "@tabtap/shared";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { PaymentsRepository } from "../data/payments.repository";
import type { ExchangeRateRecord, TableContext } from "../data/records";
import { TablesRepository } from "../data/tables.repository";
import { TenantsRepository, type TenantRecord } from "../data/tenants.repository";

/** A restaurant's own data, as its staff manage it in the admin panel. */
@Injectable()
export class RestaurantService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenants: TenantsRepository,
    private readonly tables: TablesRepository,
    private readonly payments: PaymentsRepository,
    private readonly rates: ExchangeRatesRepository,
  ) {}

  async settings(tenantId: string, role: StaffRole): Promise<TenantSettingsView> {
    return toSettingsView(await this.tenants.findById(tenantId), role);
  }

  async updateSettings(
    tenantId: string,
    role: StaffRole,
    changes: { name?: string; paymentCurrencies?: string[]; tipPercentOptions?: number[] },
  ): Promise<TenantSettingsView> {
    const tenant = await this.tenants.findById(tenantId);
    const paymentCurrencies = changes.paymentCurrencies?.filter((c) => c !== tenant.defaultCurrency);
    const tipPercentOptions =
      changes.tipPercentOptions && [...new Set(changes.tipPercentOptions)].sort((a, b) => a - b);
    const updated = await this.tenants.updateSettings(tenantId, {
      name: changes.name?.trim(),
      paymentCurrencies,
      tipPercentOptions,
    });
    return toSettingsView(updated, role);
  }

  listVenues(tenantId: string): Promise<VenueView[]> {
    return this.tenants.listVenues(tenantId);
  }

  createVenue(tenantId: string, v: { name: string; address?: string | null; timezone: string }): Promise<VenueView> {
    return this.tenants.createVenue(tenantId, {
      name: v.name.trim(),
      address: v.address?.trim() || null,
      timezone: v.timezone,
    });
  }

  updateVenue(tenantId: string, venueId: string, v: { name?: string; address?: string | null; timezone?: string }) {
    return this.tenants.updateVenue(tenantId, venueId, {
      name: v.name?.trim(),
      address: v.address === undefined ? undefined : v.address?.trim() || null,
      timezone: v.timezone,
    });
  }

  async listTables(tenantId: string): Promise<AdminTableView[]> {
    return (await this.tables.listByTenant(tenantId)).map((t) => this.toTableView(t));
  }

  async createTable(tenantId: string, t: { venueId: string; label: string; posTableRef: string }) {
    await this.tenants.findVenue(tenantId, t.venueId);
    const id = await this.tables.create(tenantId, t.venueId, t.label.trim(), t.posTableRef.trim());
    return this.toTableView(await this.tables.findInTenant(tenantId, id));
  }

  async updateTable(
    tenantId: string,
    tableId: string,
    changes: { label?: string; posTableRef?: string; isActive?: boolean },
  ): Promise<AdminTableView> {
    await this.tables.update(tenantId, tableId, {
      label: changes.label?.trim(),
      posTableRef: changes.posTableRef?.trim(),
      isActive: changes.isActive,
    });
    return this.toTableView(await this.tables.findInTenant(tenantId, tableId));
  }

  async rotateQr(tenantId: string, tableId: string): Promise<AdminTableView> {
    await this.tables.rotateQrToken(tenantId, tableId);
    return this.toTableView(await this.tables.findInTenant(tenantId, tableId));
  }

  listPayments(tenantId: string): Promise<AdminPaymentView[]> {
    return this.payments.listByTenant(tenantId);
  }

  async listExchangeRates(tenantId: string): Promise<ExchangeRateView[]> {
    return (await this.rates.listCurrent(tenantId)).map(toRateView);
  }

  async setExchangeRate(tenantId: string, base: string, quote: string, rate: string): Promise<ExchangeRateView> {
    return toRateView(await this.rates.insert(tenantId, base, quote, rate, "manual"));
  }

  private toTableView(t: TableContext): AdminTableView {
    return {
      id: t.tableId,
      venueId: t.venueId,
      label: t.tableLabel,
      qrToken: t.qrToken,
      posTableRef: t.posTableRef,
      isActive: t.isActive,
      guestUrl: `${this.config.guestAppUrl}/?table=${encodeURIComponent(t.qrToken)}`,
    };
  }
}

function toSettingsView(t: TenantRecord, role: StaffRole): TenantSettingsView {
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    defaultCurrency: t.defaultCurrency,
    status: t.status,
    platformFeeBps: t.platformFeeBps,
    paymentCurrencies: t.paymentCurrencies,
    tipPercentOptions: t.tipPercentOptions,
    role,
  };
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
