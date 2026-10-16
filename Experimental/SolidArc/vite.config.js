import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync } from "node:fs";
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "runtime-license-copy",
      closeBundle() {
        const Output = fileURLToPath(
          new URL("./dist/Notices/", import.meta.url),
        );
        mkdirSync(Output, { recursive: true });
        for (const Name of ["EmscriptenLicense.txt", "LibcxxLicense.txt"])
          copyFileSync(
            fileURLToPath(new URL(`./Runtime/${Name}`, import.meta.url)),
            `${Output}/${Name}`,
          );
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    headers: { "Cache-Control": "no-store" },
    proxy: { "/native": { target: "http://127.0.0.1:8081", changeOrigin: false } },
    allowedHosts: true,
    fs: {
      allow: [
        fileURLToPath(new URL("../..", import.meta.url)),
        fileURLToPath(
          new URL("../../EngineContent/Fonts/SunReference", import.meta.url),
        ),
      ],
    },
  },
  worker: { format: "es" },
  build: { assetsInlineLimit: 0 },
  preview: { host: "0.0.0.0", port: 5173, allowedHosts: true },
});
