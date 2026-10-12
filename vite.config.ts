import { defineConfig } from "vite";

// Dev/preview server is exposed to the sandbox preview proxy: bind 0.0.0.0 and accept any host header.
export default defineConfig({
  server: { host: "0.0.0.0", port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: "0.0.0.0", port: 4173, strictPort: true, allowedHosts: true },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 }
});
