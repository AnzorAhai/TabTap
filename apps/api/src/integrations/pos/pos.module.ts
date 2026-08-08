import { Module } from "@nestjs/common";
import { POS_CONNECTOR } from "./pos-connector.interface";
import { MockPOSConnector } from "./mock-pos.connector";

// POS_CONNECTOR_TYPE selects the adapter per deployment/tenant setup.
// Only "mock" exists today; real adapters (iiko, r_keeper, ...) register here as they're built.
const posConnectorProvider = {
  provide: POS_CONNECTOR,
  useClass: MockPOSConnector,
};

@Module({
  providers: [posConnectorProvider],
  exports: [POS_CONNECTOR],
})
export class PosModule {}
