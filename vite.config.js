import { defineConfig } from 'vite';

// The preview environment proxies the dev server through
// https://<port>-<sandbox-id>.e2b.app, so the host check must allow it and the
// server must bind to all interfaces.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
