import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.integration.test.ts'],
    alias: {
      '@/': path.resolve(__dirname, 'src') + '/',
    },
    env: {
      EXPO_PUBLIC_API_URL: 'http://localhost:3000',
    },
  },
});
