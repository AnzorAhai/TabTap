import { Injectable } from "@nestjs/common";
import { PaymentStatus } from "@tabtap/shared";
import {
  CreatePaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  WebhookResult,
} from "./payment-provider.interface";

// Settles instantly with no real card entry — lets the guest flow be smoke-tested
// end-to-end before a real payment provider account exists.
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly type = "mock";
  private counter = 0;

  async createPaymentIntent(_input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    this.counter += 1;
    return {
      providerRef: `mock-pi-${this.counter}`,
      status: PaymentStatus.SUCCEEDED,
    };
  }

  async confirmPayment(): Promise<PaymentStatus> {
    return PaymentStatus.SUCCEEDED;
  }

  async handleWebhook(): Promise<WebhookResult | null> {
    return null;
  }

  async refund(): Promise<void> {
    // no-op in mock mode
  }
}
