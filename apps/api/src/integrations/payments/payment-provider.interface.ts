/** Outcome as a payment gateway reports it. */
export type ProviderPaymentStatus = "pending" | "succeeded" | "failed";

export interface CreateIntentInput {
  /** TabTap payment id — also a natural idempotency key for the gateway. */
  paymentId: string;
  /** What to charge, in the charge currency's minor unit. */
  amountMinor: number;
  currency: string;
  description: string;
}

export interface IntentResult {
  providerRef: string;
  status: ProviderPaymentStatus;
  failureReason?: string;
}

export interface WebhookResult {
  providerRef: string;
  status: ProviderPaymentStatus;
  failureReason?: string;
}

// Every payment gateway implements this contract. Card data and bank credentials go
// from the guest straight to the gateway's own UI — never through the TabTap backend.
export interface PaymentProvider {
  readonly type: string;

  createIntent(input: CreateIntentInput): Promise<IntentResult>;
  /** Asks the gateway for the current status (fallback when a webhook is late or lost). */
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  /** Best-effort: stop a payment that is no longer wanted (canceled or expired hold). */
  cancel(providerRef: string): Promise<void>;
  /** Verifies and parses a webhook call; throws if the signature is invalid. Null = not relevant. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult | null>;
  refund(providerRef: string, amountMinor?: number): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
