export const APP_CONFIG = Symbol("APP_CONFIG");

export type NodeEnv = "development" | "production" | "test";
export type PosConnectorType = "mock";
export type PaymentProviderType = "mock" | "stripe";

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /** Browser origins allowed to call the API (guest app, admin panel). */
  corsOrigins: string[];
  /** Base URL of the guest app, used to build table QR links. */
  guestAppUrl: string;
  /** Off only in tests that fire many requests in a burst. */
  rateLimitEnabled: boolean;
  /** Requests per minute per client IP, applied to every route unless overridden. */
  rateLimitPerMinute: number;
  /** How long a started payment holds its items/shares before they are released. */
  paymentHoldMinutes: number;
  /** Expiry sweeper and POS sync worker; off in tests, which drive them directly. */
  backgroundJobs: boolean;
  /**
   * Bearer token for admin write endpoints until staff accounts exist.
   * Unset = those endpoints are disabled.
   */
  adminApiToken?: string;
  posConnectorType: PosConnectorType;
  paymentProviderType: PaymentProviderType;
  mockPaymentFlow: MockPaymentFlow;
  stripe: {
    secretKey?: string;
    webhookSecret?: string;
  };
}

export type MockPaymentFlow = "instant" | "manual";

const NODE_ENVS: readonly NodeEnv[] = ["development", "production", "test"];
const POS_CONNECTOR_TYPES: readonly PosConnectorType[] = ["mock"];
const PAYMENT_PROVIDER_TYPES: readonly PaymentProviderType[] = ["mock", "stripe"];
const MOCK_PAYMENT_FLOWS: readonly MockPaymentFlow[] = ["instant", "manual"];
const BOOLEANS = ["true", "false"] as const;

const DEV_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee apps/api/.env.example`);
    this.name = "ConfigError";
  }
}

function oneOf<T extends string>(
  problems: string[],
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = raw?.trim() || fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    problems.push(`${name} must be one of: ${allowed.join(", ")} (got "${value}")`);
    return fallback;
  }
  return value as T;
}

function positiveInt(problems: string[], name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    problems.push(`${name} must be a positive integer (got "${raw}")`);
    return fallback;
  }
  return value;
}

function parseOrigins(problems: string[], raw: string): string[] {
  const origins = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin) {
        problems.push(`CORS_ORIGINS entry "${origin}" must be a bare origin like https://app.example.com`);
      }
    } catch {
      problems.push(`CORS_ORIGINS entry "${origin}" is not a valid URL`);
    }
  }
  return origins;
}

/**
 * Reads and validates all environment variables once at startup, so a
 * misconfigured deploy fails immediately with every problem listed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];

  const nodeEnv = oneOf(problems, "NODE_ENV", env.NODE_ENV, NODE_ENVS, "development");
  const isProduction = nodeEnv === "production";

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    problems.push("DATABASE_URL is required");
  }

  let corsOrigins: string[];
  if (env.CORS_ORIGINS?.trim()) {
    corsOrigins = parseOrigins(problems, env.CORS_ORIGINS);
  } else if (isProduction) {
    problems.push("CORS_ORIGINS is required in production (comma-separated list of frontend origins)");
    corsOrigins = [];
  } else {
    corsOrigins = DEV_CORS_ORIGINS;
  }

  const guestAppUrl = (env.GUEST_APP_URL?.trim() || "http://localhost:5173").replace(/\/+$/, "");
  try {
    new URL(guestAppUrl);
  } catch {
    problems.push(`GUEST_APP_URL is not a valid URL (got "${guestAppUrl}")`);
  }

  const paymentProviderType = oneOf(
    problems,
    "PAYMENT_PROVIDER_TYPE",
    env.PAYMENT_PROVIDER_TYPE,
    PAYMENT_PROVIDER_TYPES,
    "mock",
  );
  const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim() || undefined;
  if (paymentProviderType === "stripe" && !stripeSecretKey) {
    problems.push("STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER_TYPE=stripe");
  }

  const adminApiToken = env.ADMIN_API_TOKEN?.trim() || undefined;
  if (adminApiToken && adminApiToken.length < 32) {
    problems.push("ADMIN_API_TOKEN must be at least 32 characters (e.g. `openssl rand -hex 32`)");
  }

  const config: AppConfig = {
    nodeEnv,
    isProduction,
    port: positiveInt(problems, "PORT", env.PORT, 3000),
    databaseUrl,
    corsOrigins,
    guestAppUrl,
    rateLimitEnabled: oneOf(problems, "RATE_LIMIT_ENABLED", env.RATE_LIMIT_ENABLED, BOOLEANS, "true") === "true",
    rateLimitPerMinute: positiveInt(problems, "RATE_LIMIT_PER_MINUTE", env.RATE_LIMIT_PER_MINUTE, 300),
    paymentHoldMinutes: positiveInt(problems, "PAYMENT_HOLD_MINUTES", env.PAYMENT_HOLD_MINUTES, 10),
    backgroundJobs: oneOf(problems, "BACKGROUND_JOBS", env.BACKGROUND_JOBS, BOOLEANS, "true") === "true",
    adminApiToken,
    posConnectorType: oneOf(problems, "POS_CONNECTOR_TYPE", env.POS_CONNECTOR_TYPE, POS_CONNECTOR_TYPES, "mock"),
    paymentProviderType,
    mockPaymentFlow: oneOf(problems, "MOCK_PAYMENT_FLOW", env.MOCK_PAYMENT_FLOW, MOCK_PAYMENT_FLOWS, "instant"),
    stripe: {
      secretKey: stripeSecretKey,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    },
  };

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
}
