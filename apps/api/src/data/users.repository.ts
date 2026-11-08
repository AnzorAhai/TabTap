import { Inject, Injectable } from "@nestjs/common";
import type { MembershipView, StaffMemberView, StaffRole } from "@tabtap/shared";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";

export interface UserRecord {
  id: string;
  login: string;
  name: string;
  passwordHash: string | null;
  isPlatformAdmin: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async findById(userId: string, db: Queryable = this.pool): Promise<UserRecord | null> {
    const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    return rows.length ? mapUser(rows[0]) : null;
  }

  async findByLogin(login: string, db: Queryable = this.pool): Promise<UserRecord | null> {
    const { rows } = await db.query(`SELECT * FROM users WHERE login = $1`, [login]);
    return rows.length ? mapUser(rows[0]) : null;
  }

  /** Returns the user with this login, creating a password-less one if there is none. */
  async findOrCreate(db: Queryable, login: string, name: string): Promise<UserRecord> {
    const { rows } = await db.query(
      `INSERT INTO users (login, name) VALUES ($1, $2)
       ON CONFLICT (login) DO UPDATE SET login = EXCLUDED.login
       RETURNING *`,
      [login, name],
    );
    return mapUser(rows[0]);
  }

  async setPassword(db: Queryable, userId: string, passwordHash: string, name?: string): Promise<void> {
    await db.query(
      `UPDATE users SET password_hash = $2, name = COALESCE(NULLIF($3, ''), name), updated_at = now() WHERE id = $1`,
      [userId, passwordHash, name ?? ""],
    );
  }

  async recordLogin(userId: string, db: Queryable = this.pool): Promise<void> {
    await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
  }

  async listMemberships(userId: string): Promise<MembershipView[]> {
    const { rows } = await this.pool.query(
      `SELECT m.tenant_id, t.name AS tenant_name, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 ORDER BY t.name`,
      [userId],
    );
    return rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name, role: r.role as StaffRole }));
  }

  async findRole(userId: string, tenantId: string, db: Queryable = this.pool): Promise<StaffRole | null> {
    const { rows } = await db.query(`SELECT role FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [
      userId,
      tenantId,
    ]);
    return rows.length ? (rows[0].role as StaffRole) : null;
  }

  /** Adds the membership; false if the user already belongs to the tenant. */
  async addMembership(db: Queryable, userId: string, tenantId: string, role: StaffRole): Promise<boolean> {
    const { rowCount } = await db.query(
      `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, tenantId, role],
    );
    return rowCount === 1;
  }

  async setRole(db: Queryable, userId: string, tenantId: string, role: StaffRole): Promise<void> {
    await db.query(`UPDATE memberships SET role = $3 WHERE user_id = $1 AND tenant_id = $2`, [userId, tenantId, role]);
  }

  async removeMembership(db: Queryable, userId: string, tenantId: string): Promise<void> {
    await db.query(`DELETE FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [userId, tenantId]);
  }

  /** Locks the tenant's memberships so concurrent role changes can't remove the last owner. */
  async lockOwners(db: Queryable, tenantId: string): Promise<string[]> {
    const { rows } = await db.query(
      `SELECT user_id FROM memberships WHERE tenant_id = $1 AND role = 'owner' FOR UPDATE`,
      [tenantId],
    );
    return rows.map((r) => r.user_id as string);
  }

  async listStaff(tenantId: string, db: Queryable = this.pool): Promise<StaffMemberView[]> {
    const { rows } = await db.query(
      `SELECT u.id, u.login, u.name, u.password_hash IS NOT NULL AS has_password, u.is_active, u.last_login_at, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.login`,
      [tenantId],
    );
    return rows.map((r) => ({
      userId: r.id,
      login: r.login,
      name: r.name,
      role: r.role as StaffRole,
      status: !r.is_active ? "disabled" : r.has_password ? "active" : "invited",
      lastLoginAt: r.last_login_at ? (r.last_login_at as Date).toISOString() : null,
    }));
  }
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as string,
    login: row.login as string,
    name: row.name as string,
    passwordHash: (row.password_hash as string | null) ?? null,
    isPlatformAdmin: row.is_platform_admin as boolean,
    isActive: row.is_active as boolean,
    lastLoginAt: (row.last_login_at as Date | null) ?? null,
  };
}
