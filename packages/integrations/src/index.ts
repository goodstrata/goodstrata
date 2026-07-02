export * from "./email.js";
export * from "./payments.js";
export * from "./sms.js";
export * from "./storage.js";

import { consoleEmailProvider, type EmailProvider, memoryEmailProvider } from "./email.js";
import { mockPaymentsProvider, type PaymentsProvider } from "./payments.js";
import { consoleSmsProvider, memorySmsProvider, type SmsProvider } from "./sms.js";
import {
  localDiskStorageProvider,
  memoryStorageProvider,
  type StorageProvider,
} from "./storage.js";

export interface Integrations {
  email: EmailProvider;
  sms: SmsProvider;
  storage: StorageProvider;
  payments: PaymentsProvider;
}

export interface IntegrationsEnv {
  EMAIL_PROVIDER?: string;
  SMS_PROVIDER?: string;
  STORAGE_PROVIDER?: string;
  PAYMENTS_PROVIDER?: string;
  DATA_DIR?: string;
  MOCK_PAYMENTS_SECRET?: string;
}

/**
 * Build the integration set from env. Every default is a zero-dependency
 * offline driver — a bare `docker compose up` works with no accounts.
 * SES / Twilio / S3 / Monoova drivers slot in here as they land.
 */
export function integrationsFromEnv(env: IntegrationsEnv): Integrations {
  const dataDir = env.DATA_DIR ?? "./data";

  const email = (() => {
    switch (env.EMAIL_PROVIDER ?? "console") {
      case "memory":
        return memoryEmailProvider();
      default:
        return consoleEmailProvider();
    }
  })();

  const sms = (() => {
    switch (env.SMS_PROVIDER ?? "console") {
      case "memory":
        return memorySmsProvider();
      default:
        return consoleSmsProvider();
    }
  })();

  const storage = (() => {
    switch (env.STORAGE_PROVIDER ?? "local") {
      case "memory":
        return memoryStorageProvider();
      default:
        return localDiskStorageProvider(dataDir);
    }
  })();

  const payments = mockPaymentsProvider(env.MOCK_PAYMENTS_SECRET);

  return { email, sms, storage, payments };
}
