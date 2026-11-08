import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { InviteLinkView, InviteStaffResult, StaffMemberView, StaffRole } from "@tabtap/shared";
import { Pool } from "pg";
import { AuthService, normalizeEmail } from "../auth/auth.service";
import type { TenantAccess } from "../auth/staff.guard";
import { UsersRepository } from "../data/users.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction } from "../database/transaction";

/**
 * Who works at a restaurant. Owners manage everyone; managers can only add and remove
 * waiters. A restaurant always keeps at least one owner.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
  ) {}

  list(tenantId: string): Promise<StaffMemberView[]> {
    return this.users.listStaff(tenantId);
  }

  async invite(
    access: TenantAccess,
    invitedBy: string,
    input: { email: string; role: StaffRole; name?: string },
  ): Promise<InviteStaffResult> {
    assertCanManage(access.role, input.role);
    const email = normalizeEmail(input.email);
    const inviteLink = await withTransaction(this.pool, async (db) => {
      const user = await this.users.findOrCreate(db, email, input.name?.trim() ?? "");
      if (!user.isActive) throw new ConflictException("This account is disabled");
      if (!(await this.users.addMembership(db, user.id, access.tenantId, input.role))) {
        throw new ConflictException(`${email} already works at this restaurant`);
      }
      // People who already have a password (e.g. at another restaurant) just sign in.
      return user.passwordHash ? null : this.auth.createInviteLink(db, user, invitedBy, "invite");
    });
    const member = (await this.list(access.tenantId)).find((m) => m.email === email)!;
    return { member, inviteLink };
  }

  /** A fresh invite link for someone who hasn't set their password yet. */
  async newInviteLink(access: TenantAccess, userId: string, requestedBy: string): Promise<InviteLinkView> {
    const role = await this.memberRole(access.tenantId, userId);
    assertCanManage(access.role, role);
    const user = (await this.users.findById(userId))!;
    if (user.passwordHash) {
      // Resetting a password could hand over the account at other restaurants too, so
      // it is left to the person themselves / TabTap support.
      throw new ConflictException("This person has already set a password and can sign in");
    }
    return this.auth.createInviteLink(this.pool, user, requestedBy, "invite");
  }

  async changeRole(access: TenantAccess, userId: string, role: StaffRole): Promise<StaffMemberView> {
    if (access.role !== "owner") throw new ForbiddenException("Only owners can change roles");
    await withTransaction(this.pool, async (db) => {
      const owners = await this.users.lockOwners(db, access.tenantId);
      const current = await this.users.findRole(userId, access.tenantId, db);
      if (!current) throw new NotFoundException("This person doesn't work at this restaurant");
      if (current === "owner" && role !== "owner" && owners.length === 1) {
        throw new ConflictException("A restaurant needs at least one owner");
      }
      await this.users.setRole(db, userId, access.tenantId, role);
    });
    return (await this.list(access.tenantId)).find((m) => m.userId === userId)!;
  }

  async remove(access: TenantAccess, userId: string): Promise<void> {
    await withTransaction(this.pool, async (db) => {
      const owners = await this.users.lockOwners(db, access.tenantId);
      const current = await this.users.findRole(userId, access.tenantId, db);
      if (!current) throw new NotFoundException("This person doesn't work at this restaurant");
      assertCanManage(access.role, current);
      if (current === "owner" && owners.length === 1) {
        throw new ConflictException("A restaurant needs at least one owner");
      }
      await this.users.removeMembership(db, userId, access.tenantId);
    });
  }

  private async memberRole(tenantId: string, userId: string): Promise<StaffRole> {
    const role = await this.users.findRole(userId, tenantId);
    if (!role) throw new NotFoundException("This person doesn't work at this restaurant");
    return role;
  }
}

/** Owners manage any role; managers manage waiters only; waiters manage nobody. */
function assertCanManage(actor: StaffRole, target: StaffRole): void {
  if (actor === "owner") return;
  if (actor === "manager" && target === "waiter") return;
  throw new ForbiddenException(
    actor === "manager" ? "Managers can only manage waiters" : "Your role doesn't allow managing staff",
  );
}
