import { Module } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/app-config";
import { DemoPosRepository } from "../../data/demo-pos.repository";
import { DemoPOSConnector } from "./demo-pos.connector";
import { POS_CONNECTOR } from "./pos-connector.interface";
import { MockPOSConnector } from "./mock-pos.connector";

// POS_CONNECTOR_TYPE selects the adapter: "mock" (in memory, for tests) or "demo" (in the
// database, for investor demos). Real adapters register here as they're built.
const posConnectorProvider = {
  provide: POS_CONNECTOR,
  inject: [APP_CONFIG, DemoPosRepository],
  useFactory: (config: AppConfig, demoOrders: DemoPosRepository) => {
    switch (config.posConnectorType) {
      case "mock":
        return new MockPOSConnector();
      case "demo":
        return new DemoPOSConnector(demoOrders);
    }
  },
};

@Module({
  providers: [posConnectorProvider],
  exports: [POS_CONNECTOR],
})
export class PosModule {}
