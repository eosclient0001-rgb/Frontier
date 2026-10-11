import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The editor is served through a proxied preview host, so the dev server accepts
// any Host header and HMR is pushed over the same secure origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    hmr: { protocol: 'wss', clientPort: 443 },
  },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
