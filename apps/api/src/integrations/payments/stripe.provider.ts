import Stripe from "stripe";
import type {
  CreateIntentInput,
  IntentResult,
  PaymentProvider,
  ProviderPaymentStatus,
  WebhookResult,
} from "./payment-provider.interface";

function toStatus(status: Stripe.PaymentIntent.Status): ProviderPaymentStatus {
  if (status === "succeeded") return "succeeded";
  if (status === "canceled") return "failed";
  return "pending";
}

// Kept for markets where Stripe operates; not available in Venezuela.
export class StripeProvider implements PaymentProvider {
  readonly type = "stripe";
  private readonly stripe: Stripe;
  private readonly webhookSecret?: string;

  constructor(options: { secretKey?: string; webhookSecret?: string }) {
    if (!options.secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not set — cannot initialize StripeProvider");
    }
    this.stripe = new Stripe(options.secretKey);
    this.webhookSecret = options.webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<IntentResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        description: input.description,
        metadata: { paymentId: input.paymentId },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: input.paymentId },
    );
    return { providerRef: intent.id, status: toStatus(intent.status) };
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    const intent = await this.stripe.paymentIntents.retrieve(providerRef);
    return toStatus(intent.status);
  }

  async cancel(providerRef: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(providerRef);
  }

  async parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookResult | null> {
    const signature = headers["stripe-signature"];
    if (!this.webhookSecret || typeof signature !== "string") {
      throw new Error("Stripe webhook secret or signature missing");
    }
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      return {
        providerRef: intent.id,
        status: event.type === "payment_intent.succeeded" ? "succeeded" : "failed",
        failureReason: intent.last_payment_error?.code ?? undefined,
      };
    }
    return null;
  }

  async refund(providerRef: string, amountMinor?: number): Promise<void> {
    await this.stripe.refunds.create({ payment_intent: providerRef, amount: amountMinor });
  }
}
