import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    cors: true,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    cors: true,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      three: path.resolve(import.meta.dirname, "vendor/three.module.js"),
    },
  },
});
