import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import type {
  AdminPaymentView,
  AdminTableView,
  CreateTableRequest,
  ExchangeRateView,
  InviteLinkView,
  InviteStaffRequest,
  InviteStaffResult,
  SetExchangeRateRequest,
  StaffMemberView,
  StaffRole,
  TenantSettingsView,
  UpdateTableRequest,
  UpdateTenantSettingsRequest,
  VenueRequest,
  VenueView,
} from "@tabtap/shared";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";
import type { AuthContext } from "../auth/auth.service";
import { AnyTenantRole, CurrentAuth, CurrentTenant, TenantRoles, type TenantAccess } from "../auth/staff.guard";
import { RestaurantService } from "./restaurant.service";
import { StaffService } from "./staff.service";
import { IsId, ParseIdPipe } from "../common/ids";

const ROLES: StaffRole[] = ["owner", "manager", "waiter"];

@ValidatorConstraint({ name: "timeZone" })
export class IsTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string" || value.length > 64) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage(): string {
    return "timezone must be an IANA time zone such as America/Caracas";
  }
}

export class UpdateSettingsDto implements UpdateTenantSettingsRequest {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @Matches(/^[A-Z]{3}$/, { each: true, message: "each payment currency must be an uppercase ISO 4217 code" })
  paymentCurrencies?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(50, { each: true })
  tipPercentOptions?: number[];
}

export class CreateVenueDto implements VenueRequest {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @Validate(IsTimeZone)
  timezone!: string;
}

export class UpdateVenueDto implements VenueRequest {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @Validate(IsTimeZone)
  timezone?: string;
}

export class CreateTableDto implements CreateTableRequest {
  @IsId()
  venueId!: string;

  @IsString()
  @Length(1, 50)
  label!: string;

  @IsString()
  @Length(1, 100)
  posTableRef!: string;
}

export class UpdateTableDto implements UpdateTableRequest {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  posTableRef?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetExchangeRateDto implements SetExchangeRateRequest {
  @Matches(/^[A-Z]{3}$/, { message: "baseCurrency must be an uppercase ISO 4217 code" })
  baseCurrency!: string;

  @Matches(/^[A-Z]{3}$/, { message: "quoteCurrency must be an uppercase ISO 4217 code" })
  quoteCurrency!: string;

  /** Units of quoteCurrency per one baseCurrency, as a plain decimal string ("236.5"). */
  @Matches(/^(?!0+(\.0+)?$)\d{1,12}(\.\d{1,8})?$/, {
    message: "rate must be a positive decimal with at most 8 decimal places, e.g. 236.5",
  })
  rate!: string;
}

export class InviteStaffDto implements InviteStaffRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(ROLES)
  role!: StaffRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class ChangeRoleDto {
  @IsIn(ROLES)
  role!: StaffRole;
}

/** Everything a restaurant's staff manage, under /tenants/:tenantId. */
@Controller("tenants/:tenantId")
export class RestaurantController {
  constructor(
    private readonly restaurant: RestaurantService,
    private readonly staff: StaffService,
  ) {}

  @AnyTenantRole()
  @Get()
  settings(@CurrentTenant() access: TenantAccess): Promise<TenantSettingsView> {
    return this.restaurant.settings(access.tenantId, access.role);
  }

  @TenantRoles("owner", "manager")
  @Patch("settings")
  updateSettings(@CurrentTenant() access: TenantAccess, @Body() dto: UpdateSettingsDto): Promise<TenantSettingsView> {
    // Renaming the restaurant is the owner's call.
    const changes = access.role === "owner" ? dto : { ...dto, name: undefined };
    return this.restaurant.updateSettings(access.tenantId, access.role, changes);
  }

  @AnyTenantRole()
  @Get("venues")
  venues(@CurrentTenant() access: TenantAccess): Promise<VenueView[]> {
    return this.restaurant.listVenues(access.tenantId);
  }

  @TenantRoles("owner", "manager")
  @Post("venues")
  createVenue(@CurrentTenant() access: TenantAccess, @Body() dto: CreateVenueDto): Promise<VenueView> {
    return this.restaurant.createVenue(access.tenantId, dto);
  }

  @TenantRoles("owner", "manager")
  @Patch("venues/:venueId")
  updateVenue(
    @CurrentTenant() access: TenantAccess,
    @Param("venueId", ParseIdPipe) venueId: string,
    @Body() dto: UpdateVenueDto,
  ): Promise<VenueView> {
    return this.restaurant.updateVenue(access.tenantId, venueId, dto);
  }

  @AnyTenantRole()
  @Get("tables")
  tables(@CurrentTenant() access: TenantAccess): Promise<AdminTableView[]> {
    return this.restaurant.listTables(access.tenantId);
  }

  @TenantRoles("owner", "manager")
  @Post("tables")
  createTable(@CurrentTenant() access: TenantAccess, @Body() dto: CreateTableDto): Promise<AdminTableView> {
    return this.restaurant.createTable(access.tenantId, dto);
  }

  @TenantRoles("owner", "manager")
  @Patch("tables/:tableId")
  updateTable(
    @CurrentTenant() access: TenantAccess,
    @Param("tableId", ParseIdPipe) tableId: string,
    @Body() dto: UpdateTableDto,
  ): Promise<AdminTableView> {
    return this.restaurant.updateTable(access.tenantId, tableId, dto);
  }

  /** New QR token for a table; printed codes with the old one stop working. */
  @TenantRoles("owner", "manager")
  @Post("tables/:tableId/rotate-qr")
  @HttpCode(200)
  rotateQr(
    @CurrentTenant() access: TenantAccess,
    @Param("tableId", ParseIdPipe) tableId: string,
  ): Promise<AdminTableView> {
    return this.restaurant.rotateQr(access.tenantId, tableId);
  }

  @AnyTenantRole()
  @Get("payments")
  payments(@CurrentTenant() access: TenantAccess): Promise<AdminPaymentView[]> {
    return this.restaurant.listPayments(access.tenantId);
  }

  @AnyTenantRole()
  @Get("exchange-rates")
  exchangeRates(@CurrentTenant() access: TenantAccess): Promise<ExchangeRateView[]> {
    return this.restaurant.listExchangeRates(access.tenantId);
  }

  /** Sets a new current rate (e.g. today's BCV USD → VES rate). */
  @TenantRoles("owner", "manager")
  @Post("exchange-rates")
  setExchangeRate(@CurrentTenant() access: TenantAccess, @Body() dto: SetExchangeRateDto): Promise<ExchangeRateView> {
    return this.restaurant.setExchangeRate(access.tenantId, dto.baseCurrency, dto.quoteCurrency, dto.rate);
  }

  @TenantRoles("owner", "manager")
  @Get("staff")
  staffList(@CurrentTenant() access: TenantAccess): Promise<StaffMemberView[]> {
    return this.staff.list(access.tenantId);
  }

  @TenantRoles("owner", "manager")
  @Post("staff")
  invite(
    @CurrentTenant() access: TenantAccess,
    @CurrentAuth() auth: AuthContext,
    @Body() dto: InviteStaffDto,
  ): Promise<InviteStaffResult> {
    return this.staff.invite(access, auth.userId, dto);
  }

  @TenantRoles("owner", "manager")
  @Post("staff/:userId/invite-link")
  @HttpCode(200)
  inviteLink(
    @CurrentTenant() access: TenantAccess,
    @CurrentAuth() auth: AuthContext,
    @Param("userId", ParseIdPipe) userId: string,
  ): Promise<InviteLinkView> {
    return this.staff.newInviteLink(access, userId, auth.userId);
  }

  @TenantRoles("owner")
  @Patch("staff/:userId")
  changeRole(
    @CurrentTenant() access: TenantAccess,
    @Param("userId", ParseIdPipe) userId: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<StaffMemberView> {
    return this.staff.changeRole(access, userId, dto.role);
  }

  @TenantRoles("owner", "manager")
  @Delete("staff/:userId")
  @HttpCode(204)
  async removeStaff(
    @CurrentTenant() access: TenantAccess,
    @Param("userId", ParseIdPipe) userId: string,
  ): Promise<void> {
    await this.staff.remove(access, userId);
  }
}
