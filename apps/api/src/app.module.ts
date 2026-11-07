import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { BillsModule } from "./bills/bills.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { RequestLoggerMiddleware } from "./common/request-logger.middleware";
import { APP_CONFIG, AppConfig } from "./config/app-config";
import { ConfigModule } from "./config/config.module";
import { DataModule } from "./data/data.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { PaymentsModule } from "./payments/payments.module";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    DataModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: config.rateLimitPerMinute }],
        skipIf: () => !config.rateLimitEnabled,
      }),
    }),
    BillsModule,
    PaymentsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).exclude("health").forRoutes("*");
  }
}
