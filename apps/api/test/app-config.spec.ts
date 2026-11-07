import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/app-config";

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("applies development defaults when only DATABASE_URL is set", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://localhost/tabtap" });

    expect(config.nodeEnv).toBe("development");
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.corsOrigins).toContain("http://localhost:5173");
    expect(config.corsOrigins).toContain("http://localhost:5174");
    expect(config.posConnectorType).toBe("mock");
    expect(config.paymentProviderType).toBe("mock");
    expect(config.rateLimitPerMinute).toBeGreaterThan(0);
  });

  it("parses production settings", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      PORT: "10000",
      DATABASE_URL: "postgresql://db/tabtap",
      CORS_ORIGINS: "https://guest.example.com, https://admin.example.com",
      GUEST_APP_URL: "https://guest.example.com/",
    });

    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(10000);
    expect(config.corsOrigins).toEqual(["https://guest.example.com", "https://admin.example.com"]);
    expect(config.guestAppUrl).toBe("https://guest.example.com");
  });

  it("requires DATABASE_URL", () => {
    expect(problemsOf({})).toEqual([expect.stringContaining("DATABASE_URL")]);
  });

  it("requires explicit CORS origins in production instead of allowing localhost", () => {
    const problems = problemsOf({ NODE_ENV: "production", DATABASE_URL: "postgresql://db/tabtap" });
    expect(problems).toEqual([expect.stringContaining("CORS_ORIGINS")]);
  });

  it("reports every problem at once", () => {
    const problems = problemsOf({
      DATABASE_URL: "postgresql://db/tabtap",
      PORT: "eighty",
      CORS_ORIGINS: "https://guest.example.com/path",
      POS_CONNECTOR_TYPE: "iiko",
      PAYMENT_PROVIDER_TYPE: "stripe",
    });

    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toMatch(/PORT/);
    expect(problems.join("\n")).toMatch(/bare origin/);
    expect(problems.join("\n")).toMatch(/POS_CONNECTOR_TYPE/);
    expect(problems.join("\n")).toMatch(/STRIPE_SECRET_KEY/);
  });
});
