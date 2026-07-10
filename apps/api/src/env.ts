import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  /** Public origin of the web app (dev: the Vite server proxying /api). */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /**
   * Public origin that serves the MCP endpoint (`/mcp`) and its
   * protected-resource metadata. In prod this is https://mcp.goodstrata.com.au;
   * locally everything is same-origin, so it defaults to APP_URL.
   */
  MCP_URL: z.string().url().optional(),

  AI_PROVIDER: z.enum(["anthropic", "local", "mock"]).default("mock"),
  AI_DEFAULT_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  EMAIL_PROVIDER: z.string().default("console"),
  SMS_PROVIDER: z.string().default("console"),
  /**
   * HMAC secret for per-recipient one-click unsubscribe tokens in notification
   * email (footer link + List-Unsubscribe header). Falls back to
   * BETTER_AUTH_SECRET at boot when unset, so unsubscribe links always work;
   * set it explicitly to rotate independently of session signing.
   */
  UNSUBSCRIBE_SECRET: z.string().min(16).optional(),
  STORAGE_PROVIDER: z.string().default("local"),
  PAYMENTS_PROVIDER: z.string().default("mock"),
  VIDEO_PROVIDER: z.string().default("console"),
  DATA_DIR: z.string().default("./data"),
  MOCK_PAYMENTS_SECRET: z.string().optional(),

  /** S3 / Cloudflare R2 object storage (STORAGE_PROVIDER=r2|s3). */
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),

  /** AWS SES (EMAIL_PROVIDER=ses). */
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_SES_FROM_EMAIL: z.string().optional(),

  /**
   * Generic SMTP (EMAIL_PROVIDER=smtp). Host/user/pass are required only when
   * EMAIL_PROVIDER=smtp (enforced at construction in integrationsFromEnv); the
   * sender address reuses AWS_SES_FROM_EMAIL. SMTP_SECURE defaults to true
   * (implicit TLS, port 465); set it to false for STARTTLS on port 587.
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  /** Twilio (SMS_PROVIDER=twilio). */
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  /** Daily.co (VIDEO_PROVIDER=daily). */
  DAILY_API_KEY: z.string().optional(),

  /** Monoova NPP / PayID (PAYMENTS_PROVIDER=monoova). */
  MONOOVA_API_BASE_URL: z.string().optional(),
  MONOOVA_API_KEY: z.string().optional(),
  MONOOVA_ACCOUNT_ID: z.string().optional(),
  MONOOVA_BANK_ACCOUNT_NUMBER: z.string().optional(),
  MONOOVA_BSB: z.string().optional(),
  MONOOVA_PAYID_NAME: z.string().optional(),
  /** PEM or hex-DER of Monoova's webhook-signing public key. */
  MONOOVA_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  /** securityToken echoed on webhook subscription (setup script). */
  MONOOVA_WEBHOOK_SECRET: z.string().optional(),

  /**
   * "Sign in with Google" (optional — both must be set to enable it). Create
   * OAuth credentials in Google Cloud Console and register the redirect URI
   * `<APP_URL>/api/auth/callback/google` (better-auth's default callback path).
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /** Serve the built web app from this directory (production single-image mode). */
  WEB_DIST: z.string().optional(),

  /** Public sandbox mode: exposes one-click demo logins on the sign-in page. */
  DEMO_MODE: z.string().optional(),

  /** Require a verified email before sign-in (set in prod once SES delivers). */
  REQUIRE_EMAIL_VERIFICATION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
