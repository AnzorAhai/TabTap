import { randomUUID } from "node:crypto";
import type { MockPaymentFlow } from "../../config/app-config";
import type {
  CreateIntentInput,
  IntentResult,
  PaymentProvider,
  ProviderPaymentStatus,
  WebhookResult,
} from "./payment-provider.interface";

/**
 * No real money moves. "instant" settles every payment immediately; "manual" leaves
 * it pending until POST /payments/:id/mock-confirm — the shape of asynchronous
 * methods like Pago Móvil, where the guest confirms in their banking app.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly type = "mock";

  constructor(private readonly flow: MockPaymentFlow) {}

  async createIntent(_input: CreateIntentInput): Promise<IntentResult> {
    return {
      providerRef: `mock_${randomUUID()}`,
      status: this.flow === "instant" ? "succeeded" : "pending",
    };
  }

  async getStatus(_providerRef: string): Promise<ProviderPaymentStatus> {
    // The outcome of a manual mock payment only ever arrives via mock-confirm.
    return "pending";
  }

  async cancel(): Promise<void> {}

  async parseWebhook(): Promise<WebhookResult | null> {
    return null;
  }

  async refund(): Promise<void> {}
}
