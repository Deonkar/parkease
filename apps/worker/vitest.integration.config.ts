import { defineConfig } from 'vitest/config';

/**
 * The booking jobs are guard-and-transaction code: every one of them is a
 * FOR UPDATE read followed by a conditional write. Mocking the database would
 * test the conditional and nothing else, so these run against a real
 * PostgreSQL 18 + PostGIS container (R-TEST-02).
 */
export default defineConfig({
  test: {
    root: '.',
    globals: false,
    include: ['test/integration/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
