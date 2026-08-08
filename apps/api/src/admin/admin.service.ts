import { Injectable } from "@nestjs/common";
import { AdminPaymentView, AdminTableView } from "@tabtap/shared";
import { TablesRepository } from "../tables/tables.repository";
import { PaymentsRepository } from "../payments/payments.repository";

// Single-tenant MVP: admin always looks at the seeded demo tenant.
// Real tenant resolution (from an authenticated session) lands with Phase 2 multi-tenancy.
const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

@Injectable()
export class AdminService {
  constructor(
    private readonly tablesRepository: TablesRepository,
    private readonly paymentsRepository: PaymentsRepository,
  ) {}

  async listTables(): Promise<AdminTableView[]> {
    const guestAppUrl = process.env.GUEST_APP_URL ?? "http://localhost:5173";
    const tables = await this.tablesRepository.listByTenant(DEMO_TENANT_ID);
    return tables.map((table) => ({
      id: table.id,
      label: table.label,
      qrToken: table.qrToken,
      isActive: table.isActive,
      guestUrl: `${guestAppUrl}/?table=${encodeURIComponent(table.qrToken)}`,
    }));
  }

  async listPayments(): Promise<AdminPaymentView[]> {
    return this.paymentsRepository.listByTenant(DEMO_TENANT_ID);
  }
}
