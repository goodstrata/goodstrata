import { describe, expect, it } from "vitest";
import { buildModelResolver } from "./deps.js";
import { loadEnv } from "./env.js";

const baseEnv = {
  DATABASE_URL: "postgres://unused",
  BETTER_AUTH_SECRET: "0123456789abcdef",
};

describe("mock-provider boot guard", () => {
  it("refuses to start in production when the provider resolves to mock", async () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: "production" } as NodeJS.ProcessEnv);
    await expect(buildModelResolver(env)).rejects.toThrow(/mock.*production/i);
  });

  it("also refuses when AI_DEFAULT_MODEL explicitly names mock", async () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: "production",
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
      AI_DEFAULT_MODEL: "mock:default",
    } as NodeJS.ProcessEnv);
    await expect(buildModelResolver(env)).rejects.toThrow(/ALLOW_MOCK_AI/);
  });

  it("allows mock in production with the explicit ALLOW_MOCK_AI=1 escape hatch", async () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: "production",
      ALLOW_MOCK_AI: "1",
    } as NodeJS.ProcessEnv);
    await expect(buildModelResolver(env)).resolves.toBeTypeOf("function");
  });

  it("allows a real provider in production", async () => {
    const env = loadEnv({
      ...baseEnv,
      NODE_ENV: "production",
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    } as NodeJS.ProcessEnv);
    await expect(buildModelResolver(env)).resolves.toBeTypeOf("function");
  });

  it("allows mock in development (with a warning, not a crash)", async () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: "development" } as NodeJS.ProcessEnv);
    await expect(buildModelResolver(env)).resolves.toBeTypeOf("function");
  });
});
