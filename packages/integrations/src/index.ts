import { z } from "zod";

export * from "./email.js";
export * from "./payments.js";
export * from "./sms.js";
export * from "./storage.js";
export * from "./video.js";

import {
  consoleEmailProvider,
  type EmailProvider,
  memoryEmailProvider,
  sesEmailProvider,
  smtpEmailProvider,
} from "./email.js";
import {
  mockPaymentsProvider,
  monoovaPaymentsProvider,
  type PaymentsProvider,
} from "./payments.js";
import {
  consoleSmsProvider,
  memorySmsProvider,
  type SmsProvider,
  twilioSmsProvider,
} from "./sms.js";
import {
  localDiskStorageProvider,
  memoryStorageProvider,
  type StorageProvider,
  s3StorageProvider,
} from "./storage.js";
import { consoleVideoProvider, dailyVideoProvider, type VideoProvider } from "./video.js";

export interface Integrations {
  email: EmailProvider;
  sms: SmsProvider;
  storage: StorageProvider;
  payments: PaymentsProvider;
  video: VideoProvider;
}

export interface IntegrationsEnv {
  EMAIL_PROVIDER?: string;
  SMS_PROVIDER?: string;
  STORAGE_PROVIDER?: string;
  PAYMENTS_PROVIDER?: string;
  VIDEO_PROVIDER?: string;
  DATA_DIR?: string;
  MOCK_PAYMENTS_SECRET?: string;
  // S3 / Cloudflare R2 (STORAGE_PROVIDER=r2|s3)
  STORAGE_BUCKET?: string;
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION?: string;
  STORAGE_ACCESS_KEY_ID?: string;
  STORAGE_SECRET_ACCESS_KEY?: string;
  // AWS SES (EMAIL_PROVIDER=ses)
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  AWS_SES_FROM_EMAIL?: string;
  // Generic SMTP (EMAIL_PROVIDER=smtp) — reuses AWS_SES_FROM_EMAIL as the sender.
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  // Twilio (SMS_PROVIDER=twilio)
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  // Daily.co (VIDEO_PROVIDER=daily)
  DAILY_API_KEY?: string;
  // Monoova NPP / PayID (PAYMENTS_PROVIDER=monoova)
  MONOOVA_API_BASE_URL?: string;
  MONOOVA_API_KEY?: string;
  MONOOVA_BANK_ACCOUNT_NUMBER?: string;
  MONOOVA_BSB?: string;
  MONOOVA_PAYID_NAME?: string;
  MONOOVA_WEBHOOK_PUBLIC_KEY?: string;
}

function required(env: IntegrationsEnv, key: keyof IntegrationsEnv, provider: string): string {
  const value = env[key];
  if (!value) throw new Error(`integrations: ${provider} requires ${key}`);
  return value;
}

// SMTP_PORT / SMTP_SECURE are external config parsed at boot: reject a NaN
// port ("587x") or a mis-typed flag ("flase") here with a precise message,
// rather than letting nodemailer fail cryptically on the first send.
const smtpPortSchema = z.coerce.number().int().min(1).max(65535);

function smtpPort(raw: string | undefined): number {
  if (!raw) return 465; // 465 = implicit TLS; 587 = STARTTLS (set SMTP_SECURE=false).
  const parsed = smtpPortSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`integrations: smtp SMTP_PORT must be an integer 1–65535, got "${raw}"`);
  }
  return parsed.data;
}

function smtpSecure(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return true;
  const normalized = raw.toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    throw new Error(`integrations: smtp SMTP_SECURE must be "true" or "false", got "${raw}"`);
  }
  return normalized === "true";
}

/**
 * Build the integration set from env. Every default is a zero-dependency
 * offline driver — a bare `docker compose up` works with no accounts.
 * SES / Twilio / Daily / S3 / Monoova drivers slot in here as they land.
 */
export function integrationsFromEnv(env: IntegrationsEnv): Integrations {
  const dataDir = env.DATA_DIR ?? "./data";

  const email = (() => {
    switch (env.EMAIL_PROVIDER ?? "console") {
      case "memory":
        return memoryEmailProvider();
      case "ses":
        return sesEmailProvider({
          region: required(env, "AWS_REGION", "ses"),
          accessKeyId: required(env, "AWS_ACCESS_KEY_ID", "ses"),
          secretAccessKey: required(env, "AWS_SECRET_ACCESS_KEY", "ses"),
          from: required(env, "AWS_SES_FROM_EMAIL", "ses"),
        });
      case "smtp":
        return smtpEmailProvider({
          host: required(env, "SMTP_HOST", "smtp"),
          port: smtpPort(env.SMTP_PORT),
          secure: smtpSecure(env.SMTP_SECURE),
          user: required(env, "SMTP_USER", "smtp"),
          pass: required(env, "SMTP_PASS", "smtp"),
          from: required(env, "AWS_SES_FROM_EMAIL", "smtp"),
        });
      default:
        return consoleEmailProvider();
    }
  })();

  const sms = (() => {
    switch (env.SMS_PROVIDER ?? "console") {
      case "memory":
        return memorySmsProvider();
      case "twilio":
        return twilioSmsProvider({
          accountSid: required(env, "TWILIO_ACCOUNT_SID", "twilio"),
          authToken: required(env, "TWILIO_AUTH_TOKEN", "twilio"),
          from: required(env, "TWILIO_PHONE_NUMBER", "twilio"),
        });
      default:
        return consoleSmsProvider();
    }
  })();

  const storage = (() => {
    switch (env.STORAGE_PROVIDER ?? "local") {
      case "memory":
        return memoryStorageProvider();
      case "r2":
      case "s3": {
        const flavour = env.STORAGE_PROVIDER === "r2" ? "r2" : "s3";
        return s3StorageProvider({
          flavour,
          bucket: required(env, "STORAGE_BUCKET", flavour),
          endpoint: env.STORAGE_ENDPOINT,
          region: env.STORAGE_REGION,
          accessKeyId: required(env, "STORAGE_ACCESS_KEY_ID", flavour),
          secretAccessKey: required(env, "STORAGE_SECRET_ACCESS_KEY", flavour),
        });
      }
      default:
        return localDiskStorageProvider(dataDir);
    }
  })();

  const payments = (() => {
    switch (env.PAYMENTS_PROVIDER ?? "mock") {
      case "monoova":
        return monoovaPaymentsProvider({
          apiBaseUrl: env.MONOOVA_API_BASE_URL ?? "https://api.m-pay.com.au",
          apiKey: required(env, "MONOOVA_API_KEY", "monoova"),
          bankAccountNumber: required(env, "MONOOVA_BANK_ACCOUNT_NUMBER", "monoova"),
          bsb: env.MONOOVA_BSB ?? "802-985",
          payIdName: env.MONOOVA_PAYID_NAME,
          webhookPublicKey: env.MONOOVA_WEBHOOK_PUBLIC_KEY,
        });
      default:
        return mockPaymentsProvider(env.MOCK_PAYMENTS_SECRET);
    }
  })();

  const video = (() => {
    switch (env.VIDEO_PROVIDER ?? "console") {
      case "daily":
        return dailyVideoProvider(required(env, "DAILY_API_KEY", "daily"));
      default:
        return consoleVideoProvider();
    }
  })();

  return { email, sms, storage, payments, video };
}
