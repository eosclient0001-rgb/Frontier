import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0', // reachable from the live preview proxy
    port: 5173,
    strictPort: true,
    allowedHosts: true, // the preview host name is not localhost
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
});
