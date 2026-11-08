import "reflect-metadata";
import { existsSync } from "node:fs";
import path from "node:path";
import { ConsoleLogger, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { initErrorReporting } from "./common/error-reporting";
import { APP_CONFIG, AppConfig, ConfigError } from "./config/app-config";

// Local development reads apps/api/.env; on a server the platform provides real
// environment variables, which always win over values from the file.
const envFile = path.join(__dirname, "..", ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // payment webhooks verify signatures over the exact bytes received
    // While shutting down (e.g. a deploy replacing this instance), answer new requests
    // with 503 instead of letting them reach already-closed resources.
    return503OnClosing: true,
    // JSON lines in production so the hosting platform's log search can filter by field.
    logger: new ConsoleLogger({ json: isProduction, colors: !isProduction }),
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  initErrorReporting(config.sentryDsn, config.nodeEnv);
  configureApp(app, config);
  await app.listen(config.port, "0.0.0.0");
  Logger.log(`TabTap API listening on port ${config.port} (${config.nodeEnv})`, "Bootstrap");
}

bootstrap().catch((err: unknown) => {
  // Logger may not be set up yet (e.g. invalid configuration), so write straight to stderr.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
