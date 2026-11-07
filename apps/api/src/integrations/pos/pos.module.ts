import { Module } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/app-config";
import { POS_CONNECTOR } from "./pos-connector.interface";
import { MockPOSConnector } from "./mock-pos.connector";

// POS_CONNECTOR_TYPE selects the adapter. Only "mock" exists today; real
// adapters register here as they're built (config validation rejects unknown types).
const posConnectorProvider = {
  provide: POS_CONNECTOR,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => {
    switch (config.posConnectorType) {
      case "mock":
        return new MockPOSConnector();
    }
  },
};

@Module({
  providers: [posConnectorProvider],
  exports: [POS_CONNECTOR],
})
export class PosModule {}
