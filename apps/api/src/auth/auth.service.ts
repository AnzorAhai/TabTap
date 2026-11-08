import { BadRequestException, GoneException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { InviteInfoView, InviteLinkView, MeView, SessionView } from "@tabtap/shared";
import { Pool } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { SessionsRepository } from "../data/sessions.repository";
import { UsersRepository, type UserRecord } from "../data/users.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction, type Queryable } from "../database/transaction";
import {
  burnPasswordCheck,
  hashPassword,
  hashSecretToken,
  newSecretToken,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "./crypto";

/** Who is making an authenticated request. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  isPlatformAdmin: boolean;
}

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

const INVITE_TTL_HOURS = 72;
/** Don't write last_used_at on every request. */
const TOUCH_INTERVAL_MS = 5 * 60_000;
const INVALID_LOGIN = "Invalid email or password";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<SessionView> {
    const user = await this.users.findByEmail(normalizeEmail(email));
    if (!user || !user.passwordHash || !user.isActive) {
      await burnPasswordCheck(password);
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException(INVALID_LOGIN);
    const session = await this.startSession(this.pool, user.id, meta);
    return { ...session, me: await this.me(user.id) };
  }

  /** Resolves a bearer token to its user, or null if it is unknown, expired or the user is disabled. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.sessions.findSession(hashSecretToken(token));
    if (!session) return null;
    const user = await this.users.findById(session.userId);
    if (!user || !user.isActive) return null;
    if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) await this.sessions.touchSession(session.id);
    return { userId: user.id, sessionId: session.id, isPlatformAdmin: user.isPlatformAdmin };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.deleteSession(sessionId);
  }

  async me(userId: string): Promise<MeView> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.isPlatformAdmin,
      memberships: await this.users.listMemberships(user.id),
    };
  }

  /** Issues a one-time link to set a password; replaces any earlier link for that user. */
  async createInviteLink(
    db: Queryable,
    user: UserRecord,
    createdBy: string | null,
    purpose: "invite" | "password_reset" = user.passwordHash ? "password_reset" : "invite",
  ): Promise<InviteLinkView> {
    const { token, hash } = newSecretToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
    await this.sessions.createInvite(db, user.id, hash, purpose, expiresAt, createdBy);
    return {
      userId: user.id,
      email: user.email,
      url: `${this.config.adminAppUrl}/invite/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getInvite(token: string): Promise<InviteInfoView> {
    const invite = await this.sessions.findInvite(hashSecretToken(token));
    if (!invite || invite.usedAt || invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("This link has expired or was already used. Ask for a new one.");
    }
    const user = await this.users.findById(invite.userId);
    if (!user || !user.isActive) throw new GoneException("This link is no longer valid.");
    return { email: user.email, name: user.name, purpose: invite.purpose, expiresAt: invite.expiresAt.toISOString() };
  }

  /** Sets the password from an invite / reset link and signs the user in. */
  async acceptInvite(
    token: string,
    password: string,
    name: string | undefined,
    meta: RequestMeta,
  ): Promise<SessionView> {
    assertPasswordPolicy(password);
    const passwordHash = await hashPassword(password);
    const { session, userId } = await withTransaction(this.pool, async (db) => {
      const invite = await this.sessions.findInvite(hashSecretToken(token), db, true);
      if (!invite || invite.usedAt || invite.expiresAt.getTime() <= Date.now()) {
        throw new GoneException("This link has expired or was already used. Ask for a new one.");
      }
      const user = await this.users.findById(invite.userId, db);
      if (!user || !user.isActive) throw new GoneException("This link is no longer valid.");
      await this.users.setPassword(db, user.id, passwordHash, name?.trim());
      await this.sessions.markInviteUsed(db, invite.id);
      // A new password signs out every other device.
      await this.sessions.deleteUserSessions(db, user.id);
      return { session: await this.startSession(db, user.id, meta), userId: user.id };
    });
    // Built after commit so it reflects the name just set.
    return { ...session, me: await this.me(userId) };
  }

  /** Writes through `db` only: it may run inside a transaction that holds the user's row lock. */
  private async startSession(db: Queryable, userId: string, meta: RequestMeta): Promise<Omit<SessionView, "me">> {
    const { token, hash } = newSecretToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlDays * 86_400_000);
    await this.sessions.createSession(db, userId, hash, expiresAt, meta);
    await this.users.recordLogin(userId, db);
    return { token, expiresAt: expiresAt.toISOString() };
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new BadRequestException(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
}
