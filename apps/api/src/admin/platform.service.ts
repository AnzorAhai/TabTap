import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTenantResult, FeeReportView, InviteLinkView, PlatformTenantView } from "@tabtap/shared";
import { monthRange } from "./months";
import { Pool } from "pg";
import { AuthService, normalizeLogin } from "../auth/auth.service";
import { PaymentMethodsRepository } from "../data/payment-methods.repository";
import { PaymentsRepository } from "../data/payments.repository";
import { TenantsRepository, toPlatformView } from "../data/tenants.repository";
import { UsersRepository } from "../data/users.repository";
import { DB_POOL } from "../database/database.module";
import { withTransaction } from "../database/transaction";

/** TabTap staff: onboarding restaurants and platform-level settings (the fee). */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly tenants: TenantsRepository,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly methods: PaymentMethodsRepository,
    private readonly payments: PaymentsRepository,
  ) {}

  /** Platform fees accrued by every restaurant in a month — the basis for monthly invoices. */
  async feeReport(month: string): Promise<FeeReportView> {
    const { from, to } = monthRange(month);
    return { month, rows: await this.payments.feeReport(from, to) };
  }

  listTenants(): Promise<PlatformTenantView[]> {
    return this.tenants.listForPlatform();
  }

  /** Creates a restaurant with its first venue and owner; returns the owner's invite link. */
  async createTenant(
    createdBy: string,
    input: {
      name: string;
      country: string;
      defaultCurrency: string;
      venueName: string;
      timezone: string;
      ownerLogin: string;
    },
  ): Promise<CreateTenantResult> {
    const ownerLogin = normalizeLogin(input.ownerLogin);
    return withTransaction(this.pool, async (db) => {
      const tenant = await this.tenants.create(db, {
        name: input.name.trim(),
        country: input.country,
        defaultCurrency: input.defaultCurrency,
      });
      await this.tenants.createVenue(
        tenant.id,
        { name: input.venueName.trim(), address: null, timezone: input.timezone },
        db,
      );
      // Card payments work out of the box; local methods are set up by the restaurant.
      await this.methods.insert(db, tenant.id, {
        method: "card",
        enabled: true,
        surchargeBps: 0,
        details: {},
        sortOrder: 1,
      });
      const owner = await this.users.findOrCreate(db, ownerLogin, "");
      await this.users.addMembership(db, owner.id, tenant.id, "owner");
      const ownerInvite = owner.passwordHash ? null : await this.auth.createInviteLink(db, owner, createdBy, "invite");
      return { tenant: toPlatformView(tenant, [ownerLogin]), ownerInvite };
    });
  }

  async updateTenant(
    tenantId: string,
    changes: { platformFeeBps?: number; status?: "active" | "suspended" },
  ): Promise<PlatformTenantView> {
    await this.tenants.updatePlatformFields(tenantId, changes);
    return (await this.listTenants()).find((t) => t.id === tenantId)!;
  }

  /** Password reset for anyone (e.g. an owner who forgot theirs) — platform support only. */
  async passwordLink(login: string, requestedBy: string): Promise<InviteLinkView> {
    const user = await this.users.findByLogin(normalizeLogin(login));
    if (!user) throw new NotFoundException("No account with this login");
    return this.auth.createInviteLink(this.pool, user, requestedBy);
  }
}
