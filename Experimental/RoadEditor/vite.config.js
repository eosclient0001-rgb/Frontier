import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Same browser-experiment contract as Experimental/FrontierEditor: no engine-root resolution,
// relative asset base so the built page opens from any path, and the sandbox preview host allowed.
export default defineConfig({
  root,
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', '.arena.ai', 'localhost'],
    port: 5173,
  },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', '.arena.ai', 'localhost'] },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
