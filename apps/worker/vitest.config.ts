import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    globals: false,
    // Integration tests need Docker and have their own config; a bare *.spec.ts
    // glob would otherwise drag them into the unit run and hang it.
    exclude: ['**/node_modules/**', 'test/integration/**'],
  },
});
