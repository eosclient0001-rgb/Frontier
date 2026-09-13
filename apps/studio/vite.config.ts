import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow proxied preview hosts (sandbox live-preview URLs).
    allowedHosts: true as unknown as string[],
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2020',
  },
});
