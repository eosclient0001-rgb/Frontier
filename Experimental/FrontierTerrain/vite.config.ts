import { defineConfig } from 'vite';

// Dev server is reachable through the sandbox preview proxy (*.e2b.app).
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], port: 5180, strictPort: true },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], port: 5180 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
