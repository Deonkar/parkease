import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks against a production build (`pnpm build` first): the interactive parts task 20
 * asks for (calculator, tabs, menu, keyboard), plus axe on every page. SEO and metadata are
 * checked separately by scripts/verify-site.mjs.
 *
 * PW_CHROMIUM_PATH points at a preinstalled Chromium where Playwright's own download is not
 * available; CI installs Playwright's browser instead.
 */
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm exec next start --port 3200',
    url: 'http://localhost:3200',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
