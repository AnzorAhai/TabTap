import { Controller, Get, Inject, Logger, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Pool } from "pg";
import { DB_POOL } from "../database/database.module";

export interface HealthReport {
  status: "ok" | "error";
  checks: { database: "ok" | "error" };
  uptimeSeconds: number;
}

// Used by the hosting platform's health check: a new deploy only receives
// traffic once it can actually reach the database.
@SkipThrottle()
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @Get()
  async check(): Promise<HealthReport> {
    const uptimeSeconds = Math.round(process.uptime());
    try {
      await this.pool.query("SELECT 1");
      return { status: "ok", checks: { database: "ok" }, uptimeSeconds };
    } catch (err) {
      this.logger.error(`Database health check failed: ${err instanceof Error ? err.message : String(err)}`);
      const report: HealthReport = { status: "error", checks: { database: "error" }, uptimeSeconds };
      throw new ServiceUnavailableException(report);
    }
  }
}
