import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The sandbox preview is proxied through an arbitrary *.e2b.app host.
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  build: { target: 'esnext' },
  assetsInclude: ['**/*.wgsl'],
});
