import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";

export interface TableRow {
  id: string;
  tenantId: string;
  venueId: string;
  label: string;
}

export interface TableListItem extends TableRow {
  qrToken: string;
  isActive: boolean;
}

@Injectable()
export class TablesRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findByQrToken(qrToken: string): Promise<TableRow> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, venue_id, label FROM tables WHERE qr_token = $1 AND is_active`,
      [qrToken],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Table with QR token ${qrToken} not found`);
    }
    const row = rows[0];
    return { id: row.id, tenantId: row.tenant_id, venueId: row.venue_id, label: row.label };
  }

  async listByTenant(tenantId: string): Promise<TableListItem[]> {
    const { rows } = await this.pool.query(
      `SELECT id, tenant_id, venue_id, label, qr_token, is_active FROM tables WHERE tenant_id = $1 ORDER BY label`,
      [tenantId],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      venueId: row.venue_id,
      label: row.label,
      qrToken: row.qr_token,
      isActive: row.is_active,
    }));
  }
}
