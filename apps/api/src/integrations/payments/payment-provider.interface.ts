import { PaymentStatus } from "@tabtap/shared";

export interface CreatePaymentIntentInput {
  amountMinor: number;
  currency: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  providerRef: string;
  clientSecret?: string;
  status: PaymentStatus;
}

export interface WebhookResult {
  providerRef: string;
  status: PaymentStatus;
}

// Every payment gateway (Stripe, Adyen, local providers) implements this contract.
// The guest app talks to the provider's own hosted UI (Payment Element, Drop-in, ...)
// directly with the clientSecret — card data never reaches the TabTap backend.
export interface PaymentProvider {
  readonly type: string;

  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  confirmPayment(providerRef: string): Promise<PaymentStatus>;
  handleWebhook(payload: unknown, signature?: string): Promise<WebhookResult | null>;
  refund(providerRef: string, amountMinor?: number): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
