import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AcceptInviteRequest, InviteInfoView, LoginRequest, MeView, SessionView } from "@tabtap/shared";
import { IsOptional, IsString, MaxLength } from "class-validator";
import type { Request } from "express";
import { AuthService, type AuthContext, type RequestMeta } from "./auth.service";
import { CurrentAuth, SignedIn } from "./staff.guard";

export class LoginDto implements LoginRequest {
  @IsString()
  @MaxLength(254)
  login!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class AcceptInviteDto implements AcceptInviteRequest {
  @IsString()
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

function meta(req: Request): RequestMeta {
  return { userAgent: req.headers["user-agent"], ip: req.ip };
}

// Brute-force protection: few attempts per minute per IP on anything that checks a secret.
const SECRET_CHECK_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(SECRET_CHECK_LIMIT)
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<SessionView> {
    return this.auth.login(dto.login, dto.password, meta(req));
  }

  @SignedIn()
  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.auth.logout(auth.sessionId);
  }

  @SignedIn()
  @Get("me")
  me(@CurrentAuth() auth: AuthContext): Promise<MeView> {
    return this.auth.me(auth.userId);
  }

  @Throttle(SECRET_CHECK_LIMIT)
  @Get("invites/:token")
  invite(@Param("token") token: string): Promise<InviteInfoView> {
    return this.auth.getInvite(token);
  }

  @Throttle(SECRET_CHECK_LIMIT)
  @Post("invites/:token/accept")
  @HttpCode(200)
  accept(@Param("token") token: string, @Body() dto: AcceptInviteDto, @Req() req: Request): Promise<SessionView> {
    return this.auth.acceptInvite(token, dto.password, dto.name, meta(req));
  }
}
