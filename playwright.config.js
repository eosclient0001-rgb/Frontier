import { defineConfig } from "@playwright/test";
const software = process.env.SOFTWARE_GPU === "1";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1100, height: 800 },
    actionTimeout: 60_000,
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
      args: software
        ? [
            "--no-sandbox",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ]
        : [],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
