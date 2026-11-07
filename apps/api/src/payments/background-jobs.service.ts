import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { PaymentsService } from "./payments.service";
import { PosSyncService } from "./pos-sync.service";

const TICK_MS = 5_000;

/** Periodically releases expired payment holds and delivers queued POS updates. */
@Injectable()
export class BackgroundJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundJobsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentsService,
    private readonly posSync: PosSyncService,
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
      await this.posSync.processDue();
    } catch (err) {
      this.logger.error("Background job tick failed", err instanceof Error ? err.stack : err);
    } finally {
      this.running = false;
    }
  }
}
