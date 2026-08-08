import { Module } from "@nestjs/common";
import { PAYMENT_PROVIDER } from "./payment-provider.interface";
import { MockPaymentProvider } from "./mock-payment.provider";
import { StripeProvider } from "./stripe.provider";

// PAYMENT_PROVIDER_TYPE=stripe requires STRIPE_SECRET_KEY; defaults to the mock
// so the flow runs locally with no external account.
const paymentProviderFactory = {
  provide: PAYMENT_PROVIDER,
  useFactory: () => {
    const type = process.env.PAYMENT_PROVIDER_TYPE ?? "mock";
    if (type === "stripe") {
      return new StripeProvider();
    }
    return new MockPaymentProvider();
  },
};

@Module({
  providers: [paymentProviderFactory],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsIntegrationModule {}
