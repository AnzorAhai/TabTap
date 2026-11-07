import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import type { AppConfig } from "./config/app-config";

/**
 * HTTP-level setup shared by the real server (main.ts) and the e2e tests,
 * so tests exercise exactly the same middleware stack as production.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  if (config.isProduction) {
    // Render (and most PaaS) terminate TLS at a proxy; trust its X-Forwarded-For
    // so rate limiting sees the real client IP instead of the proxy's.
    app.set("trust proxy", 1);
  }
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
}
