import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    globals: false,
    // Integration tests need Docker and have their own config; a bare *.spec.ts
    // glob would otherwise drag them into the unit run and hang it.
    exclude: ['**/node_modules/**', 'test/integration/**'],
    /**
     * The env schema calls `process.exit(1)` on a missing variable, which kills
     * the test runner rather than failing a test (learnings.md). Fake values
     * satisfy the module-level validation; nothing here reaches a network.
     */
    env: {
      DATABASE_URL: 'postgres://parkease:parkease@localhost:5432/parkease_test',
      REDIS_URL: 'redis://localhost:6379',
      RAZORPAY_KEY_ID: 'rzp_test_fake0000000000',
      RAZORPAY_KEY_SECRET: 'fakesecretfakesecret00',
    },
  },
});
