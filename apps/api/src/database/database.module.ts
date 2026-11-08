import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { tenantAwarePool } from "./tenant-scope";

export const DB_POOL = Symbol("DB_POOL");

const logger = new Logger("Database");

const poolProvider = {
  provide: DB_POOL,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Without a listener, an error on an idle client (e.g. the server closing
    // the connection) is emitted as an unhandled 'error' event and crashes the process.
    pool.on("error", (err) => logger.error(`Idle database client error: ${err.message}`, err.stack));
    return tenantAwarePool(pool);
  },
};

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  // Runs after the HTTP server has stopped. Give queries that are still running a
  // few seconds to finish rather than cutting them off.
  async onApplicationShutdown(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (this.pool.totalCount > this.pool.idleCount && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [poolProvider, DatabaseShutdown],
  exports: [DB_POOL],
})
export class DatabaseModule {}
