import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  LOGIN_PATTERN,
  type CreateTenantRequest,
  type CreateTenantResult,
  type FeeReportView,
  type InviteLinkView,
  type PlatformTenantView,
  type UpdatePlatformTenantRequest,
} from "@tabtap/shared";
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, Validate } from "class-validator";
import type { AuthContext } from "../auth/auth.service";
import { CurrentAuth, PlatformAdmin } from "../auth/staff.guard";
import { currentMonth } from "./months";
import { PlatformService } from "./platform.service";
import { IsTimeZone } from "./restaurant.controller";
import { ParseIdPipe } from "../common/ids";

export class CreateTenantDto implements CreateTenantRequest {
  @IsString()
  @Length(1, 100)
  name!: string;

  @Matches(/^[A-Z]{2}$/, { message: "country must be an ISO 3166-1 alpha-2 code such as VE" })
  country!: string;

  @Matches(/^[A-Z]{3}$/, { message: "defaultCurrency must be an uppercase ISO 4217 code" })
  defaultCurrency!: string;

  @IsString()
  @Length(1, 100)
  venueName!: string;

  @Validate(IsTimeZone)
  timezone!: string;

  @Matches(LOGIN_PATTERN, { message: "login must be 3-254 letters, digits or . _ - @" })
  ownerLogin!: string;
}

export class UpdatePlatformTenantDto implements UpdatePlatformTenantRequest {
  /** Platform fee in basis points of the bill amount (150 = 1.5%), capped at 10%. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  platformFeeBps?: number;

  @IsOptional()
  @IsIn(["active", "suspended"])
  status?: "active" | "suspended";
}

export class PasswordLinkDto {
  @IsString()
  @MaxLength(254)
  login!: string;
}

/** TabTap staff only. */
@PlatformAdmin()
@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("tenants")
  tenants(): Promise<PlatformTenantView[]> {
    return this.platform.listTenants();
  }

  @Post("tenants")
  createTenant(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTenantDto): Promise<CreateTenantResult> {
    return this.platform.createTenant(auth.userId, dto);
  }

  @Patch("tenants/:tenantId")
  updateTenant(
    @Param("tenantId", ParseIdPipe) tenantId: string,
    @Body() dto: UpdatePlatformTenantDto,
  ): Promise<PlatformTenantView> {
    return this.platform.updateTenant(tenantId, dto);
  }

  /** Platform fees accrued per restaurant in a month (default: this month) — for invoicing. */
  @Get("fees")
  fees(@Query("month") month?: string): Promise<FeeReportView> {
    return this.platform.feeReport(month ?? currentMonth());
  }

  /** A link to set a new password, for someone who lost theirs. */
  @Post("password-links")
  @HttpCode(200)
  passwordLink(@CurrentAuth() auth: AuthContext, @Body() dto: PasswordLinkDto): Promise<InviteLinkView> {
    return this.platform.passwordLink(dto.login, auth.userId);
  }
}
