import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // The sandbox proxies the preview through https://<port>-<id>.e2b.app, so
    // the dev server must bind all interfaces and accept that Host header.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
  },
  build: { target: 'es2022', sourcemap: false },
});
