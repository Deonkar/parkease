import { defineConfig } from 'vitest/config';

import unitConfig from './vitest.config.js';

/**
 * Integration tests run against a real PostgreSQL 18 + PostGIS 3.6 container
 * (R-TEST-02). The spatial index, the JSONB price path and the NOT EXISTS
 * availability probe all vanish under a mocked database, and those are the
 * three things worth testing.
 */
export default defineConfig({
  test: {
    ...unitConfig.test,
    include: ['test/integration/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**'],
    // Pulling and starting the postgis image dominates the first run.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // One container per file, and the files share nothing.
    fileParallelism: false,
  },
});
