import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";
import type { Queryable } from "../database/transaction";

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  lastUsedAt: Date;
}

export interface InviteRecord {
  id: string;
  userId: string;
  purpose: "invite" | "password_reset";
  expiresAt: Date;
  usedAt: Date | null;
}

/** Sessions and one-time invite links; both are looked up by the SHA-256 of their token. */
@Injectable()
export class SessionsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async createSession(
    db: Queryable,
    userId: string,
    tokenHash: Buffer,
    expiresAt: Date,
    meta: { userAgent?: string; ip?: string },
  ): Promise<void> {
    await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, expiresAt, meta.userAgent?.slice(0, 300) ?? null, meta.ip ?? null],
    );
  }

  async findSession(tokenHash: Buffer): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, expires_at, last_used_at FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
      [tokenHash],
    );
    if (!rows.length) return null;
    return { id: rows[0].id, userId: rows[0].user_id, expiresAt: rows[0].expires_at, lastUsedAt: rows[0].last_used_at };
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [sessionId]);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }

  async deleteUserSessions(db: Queryable, userId: string): Promise<void> {
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }

  /** A new link replaces any earlier unused ones for the same user. */
  async createInvite(
    db: Queryable,
    userId: string,
    tokenHash: Buffer,
    purpose: InviteRecord["purpose"],
    expiresAt: Date,
    createdBy: string | null,
  ): Promise<void> {
    await db.query(`DELETE FROM user_invites WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await db.query(
      `INSERT INTO user_invites (user_id, token_hash, purpose, expires_at, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, purpose, expiresAt, createdBy],
    );
  }

  async findInvite(tokenHash: Buffer, db: Queryable = this.pool, lock = false): Promise<InviteRecord | null> {
    const { rows } = await db.query(
      `SELECT id, user_id, purpose, expires_at, used_at FROM user_invites WHERE token_hash = $1${lock ? " FOR UPDATE" : ""}`,
      [tokenHash],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, userId: r.user_id, purpose: r.purpose, expiresAt: r.expires_at, usedAt: r.used_at };
  }

  async markInviteUsed(db: Queryable, inviteId: string): Promise<void> {
    await db.query(`UPDATE user_invites SET used_at = now() WHERE id = $1`, [inviteId]);
  }

  /** Housekeeping: expired sessions, and invites that ended over a week ago. */
  async deleteExpired(): Promise<number> {
    const a = await this.pool.query(`DELETE FROM sessions WHERE expires_at <= now()`);
    const b = await this.pool.query(`DELETE FROM user_invites WHERE expires_at <= now() - interval '7 days'`);
    return (a.rowCount ?? 0) + (b.rowCount ?? 0);
  }
}
