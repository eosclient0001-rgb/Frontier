import { defineConfig } from "vite";
import path from "node:path";
import { resolve } from "node:path";

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
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        textureGen: resolve(import.meta.dirname, "texture-generator.html"),
        rockStudio: resolve(import.meta.dirname, "rock-crack-studio.html"),
      },
    },
  },
  resolve: {
    alias: {
      three: path.resolve(import.meta.dirname, "vendor/three.module.js"),
    },
  },
});
