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
  // Object storage (S3 or Cloudflare R2). R2 sets STORAGE_ENDPOINT; plain S3 doesn't.
  STORAGE_BUCKET?: string;
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION?: string;
  STORAGE_ACCESS_KEY_ID?: string;
  STORAGE_SECRET_ACCESS_KEY?: string;
  // Daily.co (committee video)
  DAILY_API_KEY?: string;
  // Google OAuth ("Sign in with Google"). Both must be set to enable it; the
  // web app hides the button otherwise. Redirect URI to register in Google
  // Cloud Console: https://my.goodstrata.com.au/api/auth/callback/google
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Monoova NPP / PayID (real payments). Presence of MONOOVA_API_KEY flips the
  // driver on; the rest tune it. MONOOVA_WEBHOOK_PUBLIC_KEY (PEM or hex-DER)
  // gates webhook verification.
  MONOOVA_API_KEY?: string;
  MONOOVA_API_BASE_URL?: string;
  MONOOVA_BANK_ACCOUNT_NUMBER?: string;
  MONOOVA_BSB?: string;
  MONOOVA_PAYID_NAME?: string;
  MONOOVA_WEBHOOK_PUBLIC_KEY?: string;
  MONOOVA_WEBHOOK_SECRET?: string;
  // Twilio SMS. All three present flips the notifier's SMS provider to twilio;
  // otherwise SMS stays "console" (email + in-app are unaffected).
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  // Expo push enhanced security (optional). The expo push provider itself is
  // always on in prod — it needs no credentials; this bearer only applies once
  // "enhanced push security" is enabled for the EAS project.
  EXPO_ACCESS_TOKEN?: string;
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
            // Invited-email RFQs now have a self-service /quote/{token} landing
            // page, so the email_rfq provider is enabled alongside the scheme
            // book (held back until the portal existed). Only lights up with SES.
            TRADE_MARKET_PROVIDERS: "scheme_book,email_rfq",
          }
        : { EMAIL_PROVIDER: "console" };

    const storage = env.STORAGE_BUCKET
      ? {
          // R2 supplies a custom endpoint; plain AWS S3 doesn't.
          STORAGE_PROVIDER: env.STORAGE_ENDPOINT ? "r2" : "s3",
          STORAGE_BUCKET: env.STORAGE_BUCKET,
          STORAGE_ENDPOINT: env.STORAGE_ENDPOINT ?? "",
          STORAGE_REGION: env.STORAGE_REGION ?? "ap-southeast-2",
          STORAGE_ACCESS_KEY_ID: env.STORAGE_ACCESS_KEY_ID ?? "",
          STORAGE_SECRET_ACCESS_KEY: env.STORAGE_SECRET_ACCESS_KEY ?? "",
        }
      : {}; // falls back to the image's ephemeral local disk until storage lands

    const video = env.DAILY_API_KEY
      ? { VIDEO_PROVIDER: "daily", DAILY_API_KEY: env.DAILY_API_KEY }
      : {};

    const google =
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
          }
        : {}; // falls back to email/password + magic link only

    const payments = env.MONOOVA_API_KEY
      ? {
          PAYMENTS_PROVIDER: "monoova",
          MONOOVA_API_BASE_URL: env.MONOOVA_API_BASE_URL ?? "https://api.m-pay.com.au",
          MONOOVA_API_KEY: env.MONOOVA_API_KEY,
          MONOOVA_BANK_ACCOUNT_NUMBER: env.MONOOVA_BANK_ACCOUNT_NUMBER ?? "",
          MONOOVA_BSB: env.MONOOVA_BSB ?? "802-985",
          MONOOVA_PAYID_NAME: env.MONOOVA_PAYID_NAME ?? "GoodStrata Levies",
          MONOOVA_WEBHOOK_PUBLIC_KEY: env.MONOOVA_WEBHOOK_PUBLIC_KEY ?? "",
          MONOOVA_WEBHOOK_SECRET: env.MONOOVA_WEBHOOK_SECRET ?? "",
        }
      : {}; // falls back to the mock provider until Monoova creds are added

    // Twilio SMS: only lights up when all three secrets are present, so a
    // half-configured account never breaks boot — SMS just stays on "console".
    const sms =
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER
        ? {
            SMS_PROVIDER: "twilio",
            TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
            TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
            TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
          }
        : {};

    super(ctx, env, {
      envVars: {
        DATABASE_URL: env.DATABASE_URL,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        APP_URL,
        // The MCP resource server + protected-resource metadata host. The same
        // container serves both my.* and mcp.*; host-routing lives in the app.
        MCP_URL: "https://mcp.goodstrata.com.au",
        ...ai,
        ...email,
        ...storage,
        ...video,
        ...google,
        ...payments,
        ...sms,
        // Expo push: credential-free (the per-project endpoint is open), so the
        // member app's device tokens get real pushes from day one.
        PUSH_PROVIDER: "expo",
        ...(env.EXPO_ACCESS_TOKEN ? { EXPO_ACCESS_TOKEN: env.EXPO_ACCESS_TOKEN } : {}),
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.APP).fetch(request);
  },
};
