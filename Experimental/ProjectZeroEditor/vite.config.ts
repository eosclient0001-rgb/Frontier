import { defineConfig } from 'vite';

// The dev server is exposed to the browser preview host, so it must listen on
// all interfaces and accept the preview origin (hence allowedHosts: true).
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
