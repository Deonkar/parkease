import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    globals: false,
    // Testcontainers-backed tests need Docker and minutes, not milliseconds.
    // They run from vitest.integration.config.ts instead.
    exclude: ['**/node_modules/**', 'test/integration/**'],
    env: {
      // Pinned so a timezone-dependent bug cannot pass locally (IST) and fail
      // in CI (UTC). `isOpenAt` must read instants in Asia/Kolkata regardless.
      TZ: 'UTC',
      NODE_ENV: 'test',
      PORT: '3000',
      APP_VERSION: '0.0.0-test',
      DATABASE_URL: 'postgresql://parkease:parkease_local@localhost:5432/parkease_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
      BOOKING_QR_SECRET: 'test-qr-secret-that-is-at-least-32-chars-long!!',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_CLIENT_EMAIL: 'test@test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
      RAZORPAY_KEY_ID: 'rzp_test_fake0000000000',
      RAZORPAY_KEY_SECRET: 'fakesecretfakesecret00',
      RAZORPAY_WEBHOOK_SECRET: 'fake_webhook_secret_000',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: '000000000000000',
      CLOUDINARY_API_SECRET: 'fake_cloudinary_secret_000',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    },
  },
});
