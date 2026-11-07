import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { AdminPaymentView, AdminTableView, ExchangeRateView, SetExchangeRateRequest } from "@tabtap/shared";
import { Matches } from "class-validator";
import { AdminTokenGuard } from "./admin-token.guard";
import { AdminService } from "./admin.service";

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

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("tables")
  listTables(): Promise<AdminTableView[]> {
    return this.admin.listTables();
  }

  @Get("payments")
  listPayments(): Promise<AdminPaymentView[]> {
    return this.admin.listPayments();
  }

  @Get("exchange-rates")
  listExchangeRates(): Promise<ExchangeRateView[]> {
    return this.admin.listExchangeRates();
  }

  /** Sets a new current rate (e.g. today's BCV USD → VES rate). Requires the admin token. */
  @UseGuards(AdminTokenGuard)
  @Post("exchange-rates")
  setExchangeRate(@Body() dto: SetExchangeRateDto): Promise<ExchangeRateView> {
    return this.admin.setExchangeRate(dto.baseCurrency, dto.quoteCurrency, dto.rate);
  }
}
