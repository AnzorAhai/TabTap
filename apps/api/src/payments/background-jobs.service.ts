import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { reportError } from "../common/error-reporting";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { SessionsRepository } from "../data/sessions.repository";
import { BcvRateService } from "../rates/bcv-rate.service";
import { PaymentsService } from "./payments.service";
import { PosSyncService } from "./pos-sync.service";

const TICK_MS = 5_000;
const CLEANUP_EVERY_MS = 60 * 60_000;
const BCV_EVERY_MS = 60 * 60_000;

/** Periodically releases expired payment holds and delivers queued POS updates. */
@Injectable()
export class BackgroundJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundJobsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastCleanup = 0;
  private lastBcv = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
    private readonly posSync: PosSyncService,
    private readonly sessions: SessionsRepository,
    private readonly bcv: BcvRateService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.backgroundJobs) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return; // a slow tick must not overlap the next one
    this.running = true;
    try {
      await this.payments.expireDue();
      await this.payments.runSimulatedChecks();
      await this.posSync.processDue();
      if (Date.now() - this.lastBcv > BCV_EVERY_MS) {
        this.lastBcv = Date.now();
        // A failing rate source must not stop the other jobs.
        await this.bcv
          .refreshAll()
          .catch((err: unknown) =>
            this.logger.warn(`BCV rate refresh failed: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
      if (Date.now() - this.lastCleanup > CLEANUP_EVERY_MS) {
        this.lastCleanup = Date.now();
        await this.sessions.deleteExpired();
      }
    } catch (err) {
      this.logger.error("Background job tick failed", err instanceof Error ? err.stack : err);
      reportError(err, "background jobs");
    } finally {
      this.running = false;
    }
  }
}
