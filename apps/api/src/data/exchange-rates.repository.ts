import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";
import { normalizeDecimal, type ExchangeRateRecord } from "./records";

@Injectable()
export class ExchangeRatesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** The rate in effect now: the newest one whose effective_at has passed. */
  async findCurrent(
    tenantId: string,
    baseCurrency: string,
    quoteCurrency: string,
    db: Queryable = this.pool,
  ): Promise<ExchangeRateRecord | null> {
    const { rows } = await db.query(
      `SELECT * FROM exchange_rates
       WHERE tenant_id = $1 AND base_currency = $2 AND quote_currency = $3 AND effective_at <= now()
       ORDER BY effective_at DESC, created_at DESC
       LIMIT 1`,
      [tenantId, baseCurrency, quoteCurrency],
    );
    return rows.length ? mapRate(rows[0]) : null;
  }

  /** The current rate of every currency pair the tenant has set. */
  async listCurrent(tenantId: string): Promise<ExchangeRateRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (base_currency, quote_currency) *
       FROM exchange_rates
       WHERE tenant_id = $1 AND effective_at <= now()
       ORDER BY base_currency, quote_currency, effective_at DESC, created_at DESC`,
      [tenantId],
    );
    return rows.map(mapRate);
  }

  async insert(
    tenantId: string,
    baseCurrency: string,
    quoteCurrency: string,
    rate: string,
    source: string,
  ): Promise<ExchangeRateRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO exchange_rates (tenant_id, base_currency, quote_currency, rate, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, baseCurrency, quoteCurrency, rate, source],
    );
    return mapRate(rows[0]);
  }
}

function mapRate(row: Record<string, unknown>): ExchangeRateRecord {
  return {
    tenantId: row.tenant_id as string,
    baseCurrency: row.base_currency as string,
    quoteCurrency: row.quote_currency as string,
    rate: normalizeDecimal(row.rate as string),
    source: row.source as string,
    effectiveAt: row.effective_at as Date,
  };
}
