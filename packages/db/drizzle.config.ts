import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: {
    // Only used by drizzle-kit CLI commands that talk to a DB; `generate` is offline.
    url: process.env.DATABASE_URL ?? "postgres://goodstrata:goodstrata@localhost:5434/goodstrata",
  },
});
