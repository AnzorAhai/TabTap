import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlatformTenantView, VenueView } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";

export interface TenantRecord {
  id: string;
  name: string;
  country: string;
  defaultCurrency: string;
  status: "active" | "suspended";
  platformFeeBps: number;
  paymentCurrencies: string[];
  tipPercentOptions: number[];
  createdAt: Date;
}

/** Restaurants (tenants) and their venues. */
@Injectable()
export class TenantsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findById(tenantId: string, db: Queryable = this.pool): Promise<TenantRecord> {
    const { rows } = await db.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    if (!rows.length) throw new NotFoundException("Restaurant not found");
    return mapTenant(rows[0]);
  }

  async create(db: Queryable, t: { name: string; country: string; defaultCurrency: string }): Promise<TenantRecord> {
    const { rows } = await db.query(
      `INSERT INTO tenants (name, country, default_currency) VALUES ($1, $2, $3) RETURNING *`,
      [t.name, t.country, t.defaultCurrency],
    );
    return mapTenant(rows[0]);
  }

  async updateSettings(
    tenantId: string,
    changes: { name?: string; paymentCurrencies?: string[]; tipPercentOptions?: number[] },
  ): Promise<TenantRecord> {
    const { rows } = await this.pool.query(
      `UPDATE tenants SET
         name = COALESCE($2, name),
         payment_currencies = COALESCE($3::jsonb, payment_currencies),
         tip_percent_options = COALESCE($4::jsonb, tip_percent_options),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        tenantId,
        changes.name ?? null,
        changes.paymentCurrencies ? JSON.stringify(changes.paymentCurrencies) : null,
        changes.tipPercentOptions ? JSON.stringify(changes.tipPercentOptions) : null,
      ],
    );
    if (!rows.length) throw new NotFoundException("Restaurant not found");
    return mapTenant(rows[0]);
  }

  async updatePlatformFields(
    tenantId: string,
    changes: { platformFeeBps?: number; status?: "active" | "suspended" },
  ): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE tenants SET
         platform_fee_bps = COALESCE($2, platform_fee_bps),
         status = COALESCE($3, status),
         updated_at = now()
       WHERE id = $1`,
      [tenantId, changes.platformFeeBps ?? null, changes.status ?? null],
    );
    if (rowCount === 0) throw new NotFoundException("Restaurant not found");
  }

  async listForPlatform(): Promise<PlatformTenantView[]> {
    const { rows } = await this.pool.query(
      `SELECT t.*, COALESCE(array_agg(u.email ORDER BY u.email) FILTER (WHERE u.id IS NOT NULL), '{}') AS owner_emails
       FROM tenants t
       LEFT JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner'
       LEFT JOIN users u ON u.id = m.user_id
       GROUP BY t.id
       ORDER BY t.created_at`,
    );
    return rows.map((row) => toPlatformView(mapTenant(row), row.owner_emails as string[]));
  }

  async listVenues(tenantId: string): Promise<VenueView[]> {
    const { rows } = await this.pool.query(`SELECT * FROM venues WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);
    return rows.map(mapVenue);
  }

  async findVenue(tenantId: string, venueId: string, db: Queryable = this.pool): Promise<VenueView> {
    const { rows } = await db.query(`SELECT * FROM venues WHERE tenant_id = $1 AND id = $2`, [tenantId, venueId]);
    if (!rows.length) throw new NotFoundException("Venue not found");
    return mapVenue(rows[0]);
  }

  async createVenue(
    tenantId: string,
    v: { name: string; address: string | null; timezone: string },
    db: Queryable = this.pool,
  ): Promise<VenueView> {
    const { rows } = await db.query(
      `INSERT INTO venues (tenant_id, name, address, timezone) VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, v.name, v.address, v.timezone],
    );
    return mapVenue(rows[0]);
  }

  async updateVenue(
    tenantId: string,
    venueId: string,
    v: { name?: string; address?: string | null; timezone?: string },
  ): Promise<VenueView> {
    const { rows } = await this.pool.query(
      `UPDATE venues SET
         name = COALESCE($3, name),
         address = CASE WHEN $4::boolean THEN $5 ELSE address END,
         timezone = COALESCE($6, timezone),
         updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, venueId, v.name ?? null, v.address !== undefined, v.address ?? null, v.timezone ?? null],
    );
    if (!rows.length) throw new NotFoundException("Venue not found");
    return mapVenue(rows[0]);
  }
}

export function toPlatformView(t: TenantRecord, ownerEmails: string[]): PlatformTenantView {
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    defaultCurrency: t.defaultCurrency,
    status: t.status,
    platformFeeBps: t.platformFeeBps,
    ownerEmails,
    createdAt: t.createdAt.toISOString(),
  };
}

function mapTenant(row: Record<string, unknown>): TenantRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    country: row.country as string,
    defaultCurrency: row.default_currency as string,
    status: row.status as "active" | "suspended",
    platformFeeBps: Number(row.platform_fee_bps),
    paymentCurrencies: row.payment_currencies as string[],
    tipPercentOptions: row.tip_percent_options as number[],
    createdAt: row.created_at as Date,
  };
}

function mapVenue(row: Record<string, unknown>): VenueView {
  return {
    id: row.id as string,
    name: row.name as string,
    address: (row.address as string | null) ?? null,
    timezone: row.timezone as string,
  };
}
