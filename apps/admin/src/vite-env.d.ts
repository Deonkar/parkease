/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Empty in dev (the Vite proxy serves /api); the API origin in production. */
  readonly VITE_API_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  /** `1` serves every request from src/lib/fixtures.ts — dev and visual checks only. */
  readonly VITE_ADMIN_FIXTURES?: string;
}
