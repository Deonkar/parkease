import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `vite --mode fixtures` serves every request from src/lib/fixtures.ts (no API, no Firebase).
  define: mode === 'fixtures' ? { 'import.meta.env.VITE_ADMIN_FIXTURES': JSON.stringify('1') } : {},
  // Same origin as the API in dev, so the admin refresh cookie (Path=/api/v1/auth/admin) is sent.
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: true },
}));
