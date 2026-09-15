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
    /**
     * The env schema calls `process.exit(1)` on a missing variable, which kills
     * the test runner rather than failing a test (learnings.md). The real
     * database URL comes from the container at runtime; these only get the
     * module past validation.
     */
    env: {
      DATABASE_URL: 'postgres://parkease:parkease@localhost:5432/parkease_test',
      REDIS_URL: 'redis://localhost:6379',
      RAZORPAY_KEY_ID: 'rzp_test_fake0000000000',
      RAZORPAY_KEY_SECRET: 'fakesecretfakesecret00',
    },
  },
});
