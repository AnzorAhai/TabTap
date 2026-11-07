import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // SWC instead of the default transformer: Nest's dependency injection relies on
  // decorator metadata (emitDecoratorMetadata), which only tsc and SWC emit.
  plugins: [swc.vite({ tsconfigFile: "./tsconfig.json" })],
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    // Starts a real PostgreSQL once per run; see test/support/global-setup.ts.
    globalSetup: ["test/support/global-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
