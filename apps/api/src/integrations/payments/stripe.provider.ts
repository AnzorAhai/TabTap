import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { PaymentStatus } from "@tabtap/shared";
import {
  CreatePaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  WebhookResult,
} from "./payment-provider.interface";

const STRIPE_TO_PAYMENT_STATUS: Record<string, PaymentStatus> = {
  requires_payment_method: PaymentStatus.PENDING,
  requires_confirmation: PaymentStatus.PENDING,
  requires_action: PaymentStatus.PENDING,
  processing: PaymentStatus.PENDING,
  succeeded: PaymentStatus.SUCCEEDED,
  canceled: PaymentStatus.FAILED,
};

@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly type = "stripe";
  private readonly stripe: Stripe;
  private readonly webhookSecret?: string;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not set — cannot initialize StripeProvider");
    }
    this.stripe = new Stripe(secretKey);
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
      metadata: input.metadata,
      automatic_payment_methods: { enabled: true },
    });
    return {
      providerRef: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      status: STRIPE_TO_PAYMENT_STATUS[intent.status] ?? PaymentStatus.PENDING,
    };
  }

  async confirmPayment(providerRef: string): Promise<PaymentStatus> {
    const intent = await this.stripe.paymentIntents.retrieve(providerRef);
    return STRIPE_TO_PAYMENT_STATUS[intent.status] ?? PaymentStatus.PENDING;
  }

  // NOTE: this requires the *raw* request body, not JSON-parsed — Stripe signature
  // verification fails otherwise. Wire this up with a raw-body route when adding webhooks for real.
  async handleWebhook(payload: unknown, signature?: string): Promise<WebhookResult | null> {
    if (!this.webhookSecret || !signature) {
      throw new Error("Stripe webhook secret or signature missing");
    }
    const event = this.stripe.webhooks.constructEvent(
      payload as string | Buffer,
      signature,
      this.webhookSecret,
    );
    if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
      const intent = event.data.object as Stripe.PaymentIntent;
      return {
        providerRef: intent.id,
        status: STRIPE_TO_PAYMENT_STATUS[intent.status] ?? PaymentStatus.PENDING,
      };
    }
    return null;
  }

  async refund(providerRef: string, amountMinor?: number): Promise<void> {
    await this.stripe.refunds.create({
      payment_intent: providerRef,
      amount: amountMinor,
    });
  }
}
