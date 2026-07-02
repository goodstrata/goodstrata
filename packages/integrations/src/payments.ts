import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Payments abstraction. The real driver is Monoova (NPP/PayID); the mock
 * driver lets dev/self-host/e2e exercise the full reconciliation loop with a
 * simulated webhook.
 */

export interface InboundPayment {
  /** Provider's unique id for this payment — idempotency key. */
  providerRef: string;
  /** The PayID / payment reference the payer used (drives matching). */
  payid: string | null;
  amountCents: number;
  paidAt: string; // ISO timestamp
  payerName: string | null;
  raw: unknown;
}

export interface PaymentsProvider {
  readonly name: string;
  /** Allocate a unique payment reference (PayID) for a levy notice. */
  createPaymentReference(input: { schemeId: string; noticeNumber: string }): Promise<string>;
  /** Verify webhook authenticity. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  /** Parse a verified webhook body into a normalized inbound payment. */
  parseWebhook(rawBody: string): InboundPayment;
}

/**
 * Mock provider: references are deterministic, webhooks are HMAC-signed with
 * a shared dev secret so the verification code path is identical to prod.
 */
export function mockPaymentsProvider(secret = "mock-payments-secret"): PaymentsProvider & {
  sign(rawBody: string): string;
  buildWebhookBody(
    input: Omit<InboundPayment, "providerRef" | "raw"> & { providerRef?: string },
  ): string;
} {
  return {
    name: "mock",
    async createPaymentReference({ noticeNumber }) {
      return `mockpay-${noticeNumber.toLowerCase()}`;
    },
    verifyWebhook(rawBody, signature) {
      if (!signature) return false;
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody) as InboundPayment;
      return {
        providerRef: body.providerRef,
        payid: body.payid ?? null,
        amountCents: body.amountCents,
        paidAt: body.paidAt,
        payerName: body.payerName ?? null,
        raw: body,
      };
    },
    sign(rawBody: string) {
      return createHmac("sha256", secret).update(rawBody).digest("hex");
    },
    buildWebhookBody(input) {
      return JSON.stringify({
        providerRef: input.providerRef ?? `mock-${randomUUID()}`,
        payid: input.payid,
        amountCents: input.amountCents,
        paidAt: input.paidAt,
        payerName: input.payerName,
      });
    },
  };
}
