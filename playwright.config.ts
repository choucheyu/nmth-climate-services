import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.RBAC_E2E_BASE_URL ?? "http://127.0.0.1:3251",
    viewport: { width: 1440, height: 1000 },
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile",
      testMatch: /responsive-smoke\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } }
    },
    {
      name: "tablet",
      testMatch: /responsive-smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: true }
    }
  ]
});
