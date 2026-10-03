import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  maxFailures: process.env.NEXUM_E2E_MAX_FAILURES ? Number(process.env.NEXUM_E2E_MAX_FAILURES) : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "on-first-retry",
  },
  webServer: [
    {
      name: "API",
      command: "cd .. && npm --prefix apps/api run start",
      url: "http://127.0.0.1:3001/api/runtime/status",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      env: {
        NODE_ENV: "test",
        NEXUM_AUTH_ENABLED: "false",
        NEXUM_AUTH_SECRET: "nexum-e2e-runtime-secret-000000000000000000000000",
        AI_PROVIDER: "mock",
        NEXUM_E2E_MOCK_AI: "true",
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        NEXUM_E2E_FAILURE_INJECTION: "true",
        NEXUM_DATABASE_URL: "postgresql://nexum:nexum@127.0.0.1:5432/nexum",
        NEXUM_DB_SSL: "false",
        NEXUM_E2E_AGENT_DELAY_MS: "0",
      },
    },
    {
      name: "Web",
      command: "cd .. && VITE_E2E=true npm --prefix apps/web run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
  ],
});
