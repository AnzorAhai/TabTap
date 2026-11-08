import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { defaultIfEmpty, from, lastValueFrom, type Observable } from "rxjs";
import type { StaffRequest } from "../auth/staff.guard";
import { DB_POOL } from "./database.module";
import type { TenantPool } from "./tenant-scope";

/** Runs every /tenants/:tenantId request restricted to that restaurant at the database level. */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(@Inject(DB_POOL) private readonly pool: TenantPool) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const access = context.switchToHttp().getRequest<StaffRequest>().tenantAccess;
    if (!access) return next.handle();
    return from(
      this.pool.runAsTenant(access.tenantId, () => lastValueFrom(next.handle().pipe(defaultIfEmpty(undefined)))),
    );
  }
}
