import { BadGatewayException, Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { ExchangeRatesRepository } from "../data/exchange-rates.repository";
import { normalizeDecimal, type ExchangeRateRecord } from "../data/records";
import { TenantsRepository } from "../data/tenants.repository";

const MAX_AGE_MS = 7 * 86_400_000;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The official BCV USD → VES rate, from a JSON source in DolarAPI's format
 * (ve.dolarapi.com/v1/dolares/oficial: { moneda, promedio, fechaActualizacion }).
 * Restaurants with rate source "bcv" get it stored as their current rate whenever it
 * changes; staff can still enter a rate by hand, which holds until the next change.
 */
@Injectable()
export class BcvRateService {
  private readonly logger = new Logger(BcvRateService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenants: TenantsRepository,
    private readonly rates: ExchangeRatesRepository,
  ) {}

  async fetchOfficialRate(fetchFn: FetchFn = fetch): Promise<{ rate: string; publishedAt: Date }> {
    const res = await fetchFn(this.config.bcvRateUrl, {
      headers: { Accept: "application/json", "User-Agent": "TabTap" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`BCV rate source answered ${res.status}`);
    const data = (await res.json()) as { moneda?: unknown; promedio?: unknown; fechaActualizacion?: unknown };
    if (data.moneda !== undefined && data.moneda !== "USD") throw new Error("BCV rate source isn't the USD rate");
    const value = typeof data.promedio === "number" ? data.promedio : Number(data.promedio);
    if (!Number.isFinite(value) || value <= 0 || value > 1e9) throw new Error("BCV rate source gave no usable rate");
    const publishedAt = new Date(String(data.fechaActualizacion));
    if (Number.isNaN(publishedAt.getTime())) throw new Error("BCV rate source gave no date");
    if (Date.now() - publishedAt.getTime() > MAX_AGE_MS) {
      throw new Error(`BCV rate is stale (published ${publishedAt.toISOString()})`);
    }
    return { rate: normalizeDecimal(value.toFixed(8)), publishedAt };
  }

  /** Background job: stores the official rate for every "bcv" restaurant it changed for. */
  async refreshAll(fetchFn?: FetchFn): Promise<number> {
    const tenantIds = await this.tenants.listBcvRateTenants();
    if (tenantIds.length === 0) return 0;
    const { rate } = await this.fetchOfficialRate(fetchFn);
    let updated = 0;
    for (const tenantId of tenantIds) {
      const current = await this.rates.findCurrent(tenantId, "USD", "VES");
      if (current?.rate === rate && current.source === "bcv") continue;
      await this.rates.insert(tenantId, "USD", "VES", rate, "bcv");
      updated += 1;
    }
    if (updated > 0) this.logger.log(`Stored BCV rate ${rate} for ${updated} restaurant(s)`);
    return updated;
  }

  /** "Update from BCV now" in the admin panel. */
  async refreshTenant(tenantId: string, fetchFn?: FetchFn): Promise<ExchangeRateRecord> {
    let rate: string;
    try {
      ({ rate } = await this.fetchOfficialRate(fetchFn));
    } catch (err) {
      this.logger.warn(`BCV rate fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadGatewayException("Couldn't get the BCV rate right now. Enter it by hand or try again later.");
    }
    return this.rates.insert(tenantId, "USD", "VES", rate, "bcv");
  }
}
