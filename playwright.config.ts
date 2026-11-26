import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. Set E2E_BASE_URL to test a deployed site; otherwise a local dev server is started.
 * Signed-in tests need E2E_EMAIL and E2E_PASSWORD for a church account (they are skipped without them).
 */
const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    permissions: ["microphone"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env["E2E_BASE_URL"] ? undefined : {
    command: "bun run dev -- --port 3000 --strictPort",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
