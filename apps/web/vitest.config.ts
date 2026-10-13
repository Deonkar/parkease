import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': ROOT } },
  // tsconfig keeps JSX for Next to compile; the tests render components themselves.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.spec.ts'],
  },
});
