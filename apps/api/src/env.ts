import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  /** Public origin of the web app (dev: the Vite server proxying /api). */
  APP_URL: z.string().url().default("http://localhost:5173"),

  AI_PROVIDER: z.enum(["anthropic", "local", "mock"]).default("mock"),
  AI_DEFAULT_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  EMAIL_PROVIDER: z.string().default("console"),
  SMS_PROVIDER: z.string().default("console"),
  STORAGE_PROVIDER: z.string().default("local"),
  PAYMENTS_PROVIDER: z.string().default("mock"),
  DATA_DIR: z.string().default("./data"),
  MOCK_PAYMENTS_SECRET: z.string().optional(),

  /** Serve the built web app from this directory (production single-image mode). */
  WEB_DIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
