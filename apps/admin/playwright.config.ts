import { defineConfig } from '@playwright/test';

/**
 * Runs against `vite --mode fixtures`: every request is served from src/lib/fixtures.ts, so these
 * flows check the screens (forms, validation, dialogs, navigation), not the API — the API's own
 * behaviour is covered by apps/api/test/integration.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5175', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --port 5175 --strictPort --mode fixtures',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
