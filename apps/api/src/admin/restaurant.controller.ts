import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { LOGIN_PATTERN, PaymentMethod, PaymentStatus } from "@tabtap/shared";
import type {
  DailySummaryView,
  FeeReportView,
  LiveTableView,
  PaymentsQuery,
  PaymentView,
  RefundPaymentRequest,
  RejectPaymentRequest,
  TenantPaymentMethodView,
  UpdatePaymentMethodsRequest,
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
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  ValidateNested,
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
import { Type } from "class-transformer";
import type { AuthContext } from "../auth/auth.service";
import { PaymentAdminService } from "./payment-admin.service";
import { currentMonth } from "./months";
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
  @IsIn(["manual", "bcv"])
  rateSource?: "manual" | "bcv";

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
  @Matches(LOGIN_PATTERN, { message: "login must be 3-254 letters, digits or . _ - @" })
  login!: string;

  @IsIn(ROLES)
  role!: StaffRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class PaymentMethodDto implements TenantPaymentMethodView {
  @IsIn(Object.values(PaymentMethod))
  method!: PaymentMethod;

  @IsBoolean()
  enabled!: boolean;

  /** Extra charge in basis points (IGTF 3% = 300), at most 10%. */
  @IsInt()
  @Min(0)
  @Max(1000)
  surchargeBps!: number;

  @IsObject()
  details!: Record<string, string>;

  @IsOptional()
  @IsInt()
  sortOrder!: number;
}

export class UpdatePaymentMethodsDto implements UpdatePaymentMethodsRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodDto)
  methods!: PaymentMethodDto[];
}

export class RejectPaymentDto implements RejectPaymentRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class RefundPaymentDto implements RefundPaymentRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class PaymentsQueryDto implements PaymentsQuery {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(Object.values(PaymentStatus))
  status?: PaymentStatus;

  @IsOptional()
  @IsIn(Object.values(PaymentMethod))
  method?: PaymentMethod;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
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
    private readonly paymentAdmin: PaymentAdminService,
  ) {}

  @AnyTenantRole()
  @Get("payment-methods")
  paymentMethods(@CurrentTenant() access: TenantAccess): Promise<TenantPaymentMethodView[]> {
    return this.paymentAdmin.listMethods(access.tenantId);
  }

  @TenantRoles("owner", "manager")
  @Put("payment-methods")
  updatePaymentMethods(
    @CurrentTenant() access: TenantAccess,
    @Body() dto: UpdatePaymentMethodsDto,
  ): Promise<TenantPaymentMethodView[]> {
    return this.paymentAdmin.replaceMethods(access.tenantId, dto.methods);
  }

  /** Staff saw the money arrive (cash in hand, transfer in the bank app). Any role: waiters take cash. */
  @AnyTenantRole()
  @Post("payments/:paymentId/confirm")
  @HttpCode(200)
  confirmPayment(
    @CurrentTenant() access: TenantAccess,
    @CurrentAuth() auth: AuthContext,
    @Param("paymentId", ParseIdPipe) paymentId: string,
  ): Promise<PaymentView> {
    return this.paymentAdmin.confirm(access.tenantId, paymentId, auth.userId);
  }

  @AnyTenantRole()
  @Post("payments/:paymentId/reject")
  @HttpCode(200)
  rejectPayment(
    @CurrentTenant() access: TenantAccess,
    @CurrentAuth() auth: AuthContext,
    @Param("paymentId", ParseIdPipe) paymentId: string,
    @Body() dto: RejectPaymentDto,
  ): Promise<PaymentView> {
    return this.paymentAdmin.reject(access.tenantId, paymentId, auth.userId, dto.reason);
  }

  /** Gives a settled payment back; for offline methods, records that staff returned the money. */
  @TenantRoles("owner", "manager")
  @Post("payments/:paymentId/refund")
  @HttpCode(200)
  refundPayment(
    @CurrentTenant() access: TenantAccess,
    @CurrentAuth() auth: AuthContext,
    @Param("paymentId", ParseIdPipe) paymentId: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentView> {
    return this.paymentAdmin.refund(access.tenantId, paymentId, auth.userId, dto.reason);
  }

  /** One day's takings in the restaurant's time zone (default: today). */
  @TenantRoles("owner", "manager")
  @Get("summary")
  summary(@CurrentTenant() access: TenantAccess, @Query("date") date?: string): Promise<DailySummaryView> {
    return this.restaurant.dailySummary(access.tenantId, date);
  }

  /** Platform fees for a month (default: this month), to be invoiced to the restaurant. */
  @TenantRoles("owner", "manager")
  @Get("fees")
  fees(@CurrentTenant() access: TenantAccess, @Query("month") month?: string): Promise<FeeReportView> {
    return this.paymentAdmin.feeReport(access.tenantId, month ?? currentMonth());
  }

  /** Fetch the official BCV rate now and make it current. */
  @TenantRoles("owner", "manager")
  @Post("exchange-rates/bcv")
  refreshBcvRate(@CurrentTenant() access: TenantAccess): Promise<ExchangeRateView> {
    return this.paymentAdmin.refreshBcvRate(access.tenantId);
  }

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

  /** What is happening at each table right now. */
  @AnyTenantRole()
  @Get("tables/live")
  liveTables(@CurrentTenant() access: TenantAccess): Promise<LiveTableView[]> {
    return this.restaurant.listLiveTables(access.tenantId);
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
  payments(@CurrentTenant() access: TenantAccess, @Query() query: PaymentsQueryDto): Promise<AdminPaymentView[]> {
    return this.restaurant.listPayments(access.tenantId, query);
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
