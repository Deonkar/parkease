import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `vite --mode fixtures` serves every request from src/lib/fixtures.ts (no API, no Firebase).
  define: mode === 'fixtures' ? { 'import.meta.env.VITE_ADMIN_FIXTURES': JSON.stringify('1') } : {},
  // Same origin as the API in dev, so the admin refresh cookie (Path=/api/v1/auth/admin) is sent.
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Vendor code in its own long-lived chunks: an app release changes the small app chunks
        // and leaves these cached, instead of busting one 1.3 MB entry on every deploy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/](antd|@ant-design|rc-[^\\/]+|@rc-component)[\\/]/.test(id))
            return 'vendor-antd';
          if (/[\\/]@tanstack[\\/]/.test(id)) return 'vendor-tanstack';
          if (/[\\/](firebase|@firebase)[\\/]/.test(id)) return 'vendor-firebase';
          // MapLibre stays with the one page that draws a map, loaded on demand.
          return undefined;
        },
      },
    },
    // The MapLibre worker is one file by design and only ever loads on the Surge page.
    chunkSizeWarningLimit: 1100,
  },
}));
