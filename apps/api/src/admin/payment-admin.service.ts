import { BadRequestException, Injectable } from "@nestjs/common";
import {
  PAYMENT_METHODS,
  type ExchangeRateView,
  type FeeReportView,
  type PaymentMethod,
  type PaymentView,
  type TenantPaymentMethodView,
} from "@tabtap/shared";
import { PaymentMethodsRepository } from "../data/payment-methods.repository";
import { PaymentsRepository } from "../data/payments.repository";
import { PaymentsService } from "../payments/payments.service";
import { BcvRateService } from "../rates/bcv-rate.service";
import { monthRange } from "./months";

type DetailRule = { required: boolean; pattern?: RegExp; message?: string };

/** Payee details each method needs; anything else is dropped. */
const DETAIL_RULES: Record<PaymentMethod, Record<string, DetailRule>> = {
  card: {},
  cash_usd: {},
  cash_ves: {},
  pago_movil: {
    bank: { required: true },
    phone: { required: true, pattern: /^[0-9+\-\s()]{7,20}$/, message: "phone must be a phone number" },
    documentId: {
      required: true,
      pattern: /^[VEJGP]-?\d{5,9}(-?\d)?$/i,
      message: "documentId must be a RIF or cédula such as J-12345678-9",
    },
    holderName: { required: false },
    verification: {
      required: false,
      pattern: /^(staff|simulated)$/,
      message: 'verification must be "staff" or "simulated"',
    },
  },
  zelle: {
    email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "email must be an email address" },
    holderName: { required: true },
    verification: {
      required: false,
      pattern: /^(staff|simulated)$/,
      message: 'verification must be "staff" or "simulated"',
    },
  },
  binance_pay: {
    payId: { required: true, pattern: /^[A-Za-z0-9]{3,40}$/, message: "payId must be a Binance Pay ID" },
    holderName: { required: false },
    verification: {
      required: false,
      pattern: /^(staff|simulated)$/,
      message: 'verification must be "staff" or "simulated"',
    },
  },
};

/** How a restaurant takes payments: methods, offline confirmations, fees, the BCV rate. */
@Injectable()
export class PaymentAdminService {
  constructor(
    private readonly methods: PaymentMethodsRepository,
    private readonly payments: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
    private readonly bcv: BcvRateService,
  ) {}

  listMethods(tenantId: string): Promise<TenantPaymentMethodView[]> {
    return this.methods.list(tenantId);
  }

  async replaceMethods(tenantId: string, input: TenantPaymentMethodView[]): Promise<TenantPaymentMethodView[]> {
    const seen = new Set<PaymentMethod>();
    const cleaned = input.map((m, index) => {
      if (seen.has(m.method)) throw new BadRequestException(`${m.method} is listed twice`);
      seen.add(m.method);
      return { ...m, sortOrder: index + 1, details: m.enabled ? cleanDetails(m.method, m.details) : keepKnown(m) };
    });
    if (!cleaned.some((m) => m.enabled)) throw new BadRequestException("Keep at least one payment method enabled");
    await this.methods.replace(tenantId, cleaned);
    return this.methods.list(tenantId);
  }

  confirm(tenantId: string, paymentId: string, userId: string): Promise<PaymentView> {
    return this.paymentsService.confirmByStaff(tenantId, paymentId, userId);
  }

  reject(tenantId: string, paymentId: string, userId: string, reason?: string): Promise<PaymentView> {
    return this.paymentsService.rejectByStaff(tenantId, paymentId, userId, reason);
  }

  refund(tenantId: string, paymentId: string, userId: string, reason?: string): Promise<PaymentView> {
    return this.paymentsService.refund(tenantId, paymentId, userId, reason);
  }

  async feeReport(tenantId: string, month: string): Promise<FeeReportView> {
    const { from, to } = monthRange(month);
    return { month, rows: await this.payments.feeReport(from, to, tenantId) };
  }

  async refreshBcvRate(tenantId: string): Promise<ExchangeRateView> {
    const r = await this.bcv.refreshTenant(tenantId);
    return {
      baseCurrency: r.baseCurrency,
      quoteCurrency: r.quoteCurrency,
      rate: r.rate,
      source: r.source,
      effectiveAt: r.effectiveAt.toISOString(),
    };
  }
}

/** Validates an enabled method's payee details against its rules. */
function cleanDetails(method: PaymentMethod, details: Record<string, string>): Record<string, string> {
  const rules = DETAIL_RULES[method];
  const out: Record<string, string> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const raw = details[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      if (rule.required) throw new BadRequestException(`${method}: ${key} is required`);
      continue;
    }
    if (value.length > 100) throw new BadRequestException(`${method}: ${key} is too long`);
    if (rule.pattern && !rule.pattern.test(value)) throw new BadRequestException(`${method}: ${rule.message}`);
    out[key] = value;
  }
  if (PAYMENT_METHODS[method].flow === "proof" && !out.verification) out.verification = "staff";
  return out;
}

/** A disabled method keeps whatever known details it had, unchecked, for when it's turned back on. */
function keepKnown(m: TenantPaymentMethodView): Record<string, string> {
  const rules = DETAIL_RULES[m.method];
  return Object.fromEntries(
    Object.entries(m.details).filter(([k, v]) => k in rules && typeof v === "string" && v.length <= 100),
  );
}
