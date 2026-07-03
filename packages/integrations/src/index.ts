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
