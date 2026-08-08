import { Bill } from "@tabtap/shared";

export interface POSConnectorCapabilities {
  supportsWebhooks: boolean;
  supportsMarkPaid: boolean;
  supportsPartialPayment: boolean;
}

export interface MarkPaidInput {
  amountMinor: number;
  paymentId: string;
}

// Every POS integration (iiko, r_keeper, Toast, ...) implements this contract.
// Core domain code depends only on this interface, never on a concrete POS SDK.
export interface POSConnector {
  readonly type: string;
  readonly capabilities: POSConnectorCapabilities;

  getOpenBill(tableExternalRef: string): Promise<Bill | null>;
  getBillDetails(billExternalRef: string): Promise<Bill>;
  markPaid(billExternalRef: string, payment: MarkPaidInput): Promise<void>;
  healthCheck(): Promise<boolean>;
}

export const POS_CONNECTOR = Symbol("POS_CONNECTOR");
