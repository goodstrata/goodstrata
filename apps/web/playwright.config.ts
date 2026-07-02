import { defineConfig, devices } from "@playwright/test";

const ADMIN_DB =
  process.env.TEST_DATABASE_URL ?? "postgres://goodstrata:goodstrata@localhost:5434/goodstrata";
const E2E_DB = ADMIN_DB.replace(/\/[^/]*$/, "/gs_e2e");

const API_PORT = 3105;
const WEB_PORT = 5273;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Recreate the e2e database inside the server command so ordering is
      // guaranteed regardless of Playwright's globalSetup/webServer sequence.
      command: [
        `psql "${ADMIN_DB}" -c 'DROP DATABASE IF EXISTS gs_e2e WITH (FORCE)' -c 'CREATE DATABASE gs_e2e'`,
        "pnpm --filter @goodstrata/api exec tsx src/index.ts",
      ].join(" && "),
      cwd: "../..",
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: E2E_DB,
        BETTER_AUTH_SECRET: "e2e-secret-0123456789abcdef",
        APP_URL: `http://localhost:${WEB_PORT}`,
        PORT: String(API_PORT),
        AI_PROVIDER: "mock",
        EMAIL_PROVIDER: "memory",
        SMS_PROVIDER: "memory",
        STORAGE_PROVIDER: "memory",
        NODE_ENV: "test",
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
