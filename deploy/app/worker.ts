import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  APP: DurableObjectNamespace<GoodstrataApp>;
  // --- required secrets (wrangler secret put) ---
  DATABASE_URL: string; // Supabase session pooler, ?sslmode=require
  BETTER_AUTH_SECRET: string;
  // --- optional secrets: presence flips the matching provider on ---
  OPENROUTER_API_KEY?: string; // agents → local:qwen via OpenRouter
  ANTHROPIC_API_KEY?: string; // agents → Anthropic (takes precedence)
  // AWS SES (transactional email)
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  AWS_SES_FROM_EMAIL?: string;
  // Cloudflare R2 (document storage, S3 API)
  STORAGE_BUCKET?: string;
  STORAGE_ENDPOINT?: string;
  STORAGE_ACCESS_KEY_ID?: string;
  STORAGE_SECRET_ACCESS_KEY?: string;
  // Daily.co (committee video)
  DAILY_API_KEY?: string;
  // Monoova (real payments) — driver lands in a later phase
  MONOOVA_API_KEY?: string;
}

const APP_URL = "https://my.goodstrata.com.au";

/**
 * Production GoodStrata app. One always-warm container (the agent event loop,
 * pg-boss workers and crons must keep running), connected to Supabase. Provider
 * selection is driven by which optional secrets are present, so email / storage
 * / AI / payments each light up the moment their credentials are added — no
 * code change, just `wrangler secret put` + redeploy.
 */
export class GoodstrataApp extends Container<Env> {
  defaultPort = 3000;
  // Keep the box warm so background agents, the levy/arrears crons and the
  // decision executor keep ticking between visitors.
  sleepAfter = "6h";

  constructor(ctx: DurableObjectState, env: Env) {
    const ai = env.ANTHROPIC_API_KEY
      ? { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }
      : env.OPENROUTER_API_KEY
        ? {
            AI_PROVIDER: "local",
            AI_DEFAULT_MODEL: "local:qwen/qwen3-30b-a3b",
            OPENAI_COMPAT_BASE_URL: "https://openrouter.ai/api",
            OPENAI_COMPAT_API_KEY: env.OPENROUTER_API_KEY,
          }
        : { AI_PROVIDER: "mock" };

    const email =
      env.AWS_SES_FROM_EMAIL && env.AWS_ACCESS_KEY_ID
        ? {
            EMAIL_PROVIDER: "ses",
            AWS_REGION: env.AWS_REGION ?? "ap-southeast-2",
            AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY ?? "",
            AWS_SES_FROM_EMAIL: env.AWS_SES_FROM_EMAIL,
            // Real mail delivers — safe to require verified addresses.
            REQUIRE_EMAIL_VERIFICATION: "1",
          }
        : { EMAIL_PROVIDER: "console" };

    const storage = env.STORAGE_BUCKET
      ? {
          STORAGE_PROVIDER: "r2",
          STORAGE_BUCKET: env.STORAGE_BUCKET,
          STORAGE_ENDPOINT: env.STORAGE_ENDPOINT ?? "",
          STORAGE_ACCESS_KEY_ID: env.STORAGE_ACCESS_KEY_ID ?? "",
          STORAGE_SECRET_ACCESS_KEY: env.STORAGE_SECRET_ACCESS_KEY ?? "",
        }
      : {}; // falls back to the image's ephemeral local disk until R2 lands

    const video = env.DAILY_API_KEY
      ? { VIDEO_PROVIDER: "daily", DAILY_API_KEY: env.DAILY_API_KEY }
      : {};

    super(ctx, env, {
      envVars: {
        DATABASE_URL: env.DATABASE_URL,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        APP_URL,
        ...ai,
        ...email,
        ...storage,
        ...video,
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.APP).fetch(request);
  },
};
