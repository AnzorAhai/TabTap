/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "true" shows the demo gateway's "bank confirmed / declined" buttons in production builds. */
  readonly VITE_DEMO_PAYMENT_CONTROLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
