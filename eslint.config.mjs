// @ts-check
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = [
  "apps/*/src/**/*.{ts,tsx}",
  "apps/*/test/**/*.ts",
  "packages/*/src/**/*.ts",
  "packages/*/test/**/*.ts",
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Type-aware rules only where a tsconfig covers the file (app/package sources and tests).
  {
    files: sourceFiles,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // pg returns rows as `any`; repositories map them field by field into typed objects.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      // Interface implementations (mock adapters) are async without awaiting anything.
      "@typescript-eslint/require-await": "off",
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  {
    files: ["apps/guest-pwa/public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },

  // Backend, scripts and config files run on Node.
  {
    files: ["apps/api/**/*.ts", "db/**/*.mjs", "**/*.config.{ts,mts,mjs}"],
    languageOptions: { globals: globals.node },
  },

  // Browser apps.
  {
    files: ["apps/guest-pwa/src/**/*.{ts,tsx}", "apps/admin/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
);
