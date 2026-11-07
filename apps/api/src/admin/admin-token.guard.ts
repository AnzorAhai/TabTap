import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { APP_CONFIG, AppConfig } from "../config/app-config";

/**
 * Protects admin write endpoints with a shared bearer token (ADMIN_API_TOKEN) until
 * staff accounts and sessions exist. Without a configured token those endpoints are off.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.adminApiToken;
    if (!expected) throw new ForbiddenException("Admin changes are disabled: ADMIN_API_TOKEN is not configured");
    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    // Compare fixed-length digests so neither length nor content leaks through timing.
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
      throw new UnauthorizedException("Invalid admin token");
    }
    return true;
  }
}
