import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app", "localhost"],
    port: 5173,
    // Formatters can briefly truncate a file; never cache that empty CSS as an HMR update.
    watch: { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
  },
  preview: { host: "0.0.0.0", allowedHosts: [".e2b.app", "localhost"] },
});
