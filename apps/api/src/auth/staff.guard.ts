import {
  applyDecorators,
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { StaffRole } from "@tabtap/shared";
import type { Request } from "express";
import { ID_PATTERN } from "../common/ids";
import { UsersRepository } from "../data/users.repository";
import { AuthService, type AuthContext } from "./auth.service";

export interface TenantAccess {
  tenantId: string;
  /** Platform admins act as owners in every restaurant. */
  role: StaffRole;
}

export interface StaffRequest extends Request {
  auth?: AuthContext;
  tenantAccess?: TenantAccess;
}

type Requirement = { kind: "signed-in" } | { kind: "tenant"; roles: StaffRole[] } | { kind: "platform-admin" };

const REQUIREMENT = "tabtap:staff-requirement";

/**
 * Admin-panel access control. Every admin route declares what it needs:
 *   @SignedIn()                     any valid session
 *   @TenantRoles("owner", ...)      a role in the restaurant from the :tenantId route param
 *   @PlatformAdmin()                TabTap staff
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<Requirement>(REQUIREMENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const req = context.switchToHttp().getRequest<StaffRequest>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const auth = token ? await this.auth.authenticate(token) : null;
    if (!auth) throw new UnauthorizedException("Sign in to continue");
    req.auth = auth;

    if (requirement.kind === "platform-admin") {
      if (!auth.isPlatformAdmin) throw new ForbiddenException("Platform admins only");
    } else if (requirement.kind === "tenant") {
      const tenantId = req.params.tenantId;
      if (typeof tenantId !== "string" || !ID_PATTERN.test(tenantId)) {
        throw new BadRequestException("Validation failed (uuid is expected)");
      }
      const role: StaffRole | null = auth.isPlatformAdmin ? "owner" : await this.users.findRole(auth.userId, tenantId);
      if (!role) throw new ForbiddenException("You don't have access to this restaurant");
      if (!requirement.roles.includes(role)) throw new ForbiddenException("Your role doesn't allow this");
      req.tenantAccess = { tenantId, role };
    }
    return true;
  }
}

export const SignedIn = () =>
  applyDecorators(SetMetadata(REQUIREMENT, { kind: "signed-in" } satisfies Requirement), UseGuards(StaffGuard));

export const TenantRoles = (...roles: StaffRole[]) =>
  applyDecorators(SetMetadata(REQUIREMENT, { kind: "tenant", roles } satisfies Requirement), UseGuards(StaffGuard));

export const AnyTenantRole = () => TenantRoles("owner", "manager", "waiter");

export const PlatformAdmin = () =>
  applyDecorators(SetMetadata(REQUIREMENT, { kind: "platform-admin" } satisfies Requirement), UseGuards(StaffGuard));

/** The signed-in user (routes guarded by StaffGuard only). */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<StaffRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});

/** The caller's access to the :tenantId restaurant (routes using @TenantRoles only). */
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantAccess => {
  const access = ctx.switchToHttp().getRequest<StaffRequest>().tenantAccess;
  if (!access) throw new ForbiddenException();
  return access;
});
