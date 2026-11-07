import { Module } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/app-config";
import { PAYMENT_PROVIDER } from "./payment-provider.interface";
import { MockPaymentProvider } from "./mock-payment.provider";
import { StripeProvider } from "./stripe.provider";

// PAYMENT_PROVIDER_TYPE selects the gateway; defaults to the mock so the flow
// runs locally with no external account.
const paymentProviderFactory = {
  provide: PAYMENT_PROVIDER,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => {
    switch (config.paymentProviderType) {
      case "stripe":
        return new StripeProvider(config.stripe);
      case "mock":
        return new MockPaymentProvider();
    }
  },
};

@Module({
  providers: [paymentProviderFactory],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsIntegrationModule {}
