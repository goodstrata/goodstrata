import {
  createHmac,
  createPublicKey,
  createVerify,
  type KeyObject,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

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
  /**
   * HTTP header the webhook route should read the signature from and hand to
   * `verifyWebhook`. Defaults to `x-signature` (the mock provider) when unset;
   * Monoova signs via `verification-signature`.
   */
  readonly signatureHeader?: string;
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

// ---------------------------------------------------------------------------
// Monoova (NPP / PayID) — the real driver.
//
// Model (mirrors the proven old implementation): one shared platform NPP bank
// account; one auto-generated PayID registered per levy notice. Every PayID
// points at the same BSB + account, so reconciliation is purely by the unique
// PayID string — exactly what recordInboundPayment matches on.
//
// Verified against the live API (https://api.m-pay.com.au):
//   - Auth: Basic base64(`${apiKey}:`) — API key as username, empty password.
//   - POST /receivables/v1/payid/registerpayid → { status:"Ok",
//       PayIdDetails:{ PayId, PayIdName, PayIdStatus, BankAccountNumber } }.
//   - Webhooks are signed RSA-SHA256 over the raw body; the public key comes
//     from GET /public/v1/certificate/public-key as hex-encoded DER (PKCS#1).
//     The signature rides the `Verification-Signature` header (base64).
// ---------------------------------------------------------------------------

export interface MonoovaConfig {
  /** e.g. https://api.m-pay.com.au */
  apiBaseUrl: string;
  apiKey: string;
  /** Shared platform NPP account every PayID resolves to. */
  bankAccountNumber: string;
  /** e.g. 802-985 */
  bsb: string;
  /** Payer-facing PayID name prefix; the notice number is appended. */
  payIdName?: string;
  /**
   * Monoova's webhook-signing public key, as either a PEM block or the
   * hex-encoded DER (PKCS#1) returned by GET /public/v1/certificate/public-key.
   * When absent, `verifyWebhook` fails closed (returns false).
   */
  webhookPublicKey?: string;
}

interface MonoovaPayIdResponse {
  status?: string;
  statusDescription?: string;
  PayIdDetails?: {
    PayId?: string;
    PayIdName?: string;
    PayIdStatus?: string;
    BankAccountNumber?: string;
  } | null;
  PayId?: string;
}

/** Coerce Monoova's hex-DER-or-PEM public key into a verifiable KeyObject. */
function toMonoovaPublicKey(material: string): KeyObject {
  const trimmed = material.trim();
  if (trimmed.includes("BEGIN")) {
    return createPublicKey(trimmed);
  }
  // Hex-encoded DER, PKCS#1 RSAPublicKey (as served by the certificate endpoint).
  const der = Buffer.from(trimmed.replace(/\s+/g, ""), "hex");
  return createPublicKey({ key: der, format: "der", type: "pkcs1" });
}

/** NPP amounts arrive as dollar strings/numbers ("150.00", 150). → cents. */
function monoovaAmountToCents(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

/**
 * Fetch Monoova's webhook-signing public key (hex-DER). Use this once at boot
 * or in a setup script to populate MONOOVA_WEBHOOK_PUBLIC_KEY.
 */
export async function fetchMonoovaPublicKey(cfg: {
  apiBaseUrl: string;
  apiKey: string;
}): Promise<string> {
  const res = await fetch(`${cfg.apiBaseUrl}/public/v1/certificate/public-key`, {
    headers: monoovaHeaders(cfg.apiKey),
  });
  const text = (await res.text()).trim();
  if (!res.ok || !text) {
    throw new Error(`Monoova public-key fetch failed (${res.status}): ${text}`);
  }
  return text;
}

/**
 * Ensure the NPPReceivePayment webhook subscription points at `targetUrl`.
 * Idempotent: re-subscribing returns WebhookAlreadySubscribed, which we treat
 * as success (call /subscriptions/v1/update to retarget when needed).
 */
export async function ensureMonoovaWebhookSubscription(
  cfg: { apiBaseUrl: string; apiKey: string; webhookSecurityToken: string },
  targetUrl: string,
): Promise<{ status: string; body: unknown }> {
  const res = await fetch(`${cfg.apiBaseUrl}/subscriptions/v1/create`, {
    method: "POST",
    headers: monoovaHeaders(cfg.apiKey),
    body: JSON.stringify({
      eventName: "NPPReceivePayment",
      targetUrl,
      subscriptionStatus: "On",
      securityToken: cfg.webhookSecurityToken,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string };
  if (res.ok) return { status: "subscribed", body };
  if (body?.status === "WebhookAlreadySubscribed") {
    return { status: "already-subscribed", body };
  }
  throw new Error(`Monoova webhook subscribe failed (${res.status}): ${JSON.stringify(body)}`);
}

function monoovaHeaders(apiKey: string): Record<string, string> {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function monoovaPaymentsProvider(cfg: MonoovaConfig): PaymentsProvider {
  const payIdNamePrefix = cfg.payIdName?.trim() || "GoodStrata Levies";
  // Parse the verification key once; a bad key must not silently pass webhooks.
  let publicKey: KeyObject | null = null;
  if (cfg.webhookPublicKey) {
    try {
      publicKey = toMonoovaPublicKey(cfg.webhookPublicKey);
    } catch (err) {
      console.error(
        "[monoova] invalid MONOOVA_WEBHOOK_PUBLIC_KEY — webhooks will be rejected",
        err,
      );
    }
  }

  return {
    name: "monoova",
    signatureHeader: "verification-signature",

    async createPaymentReference({ noticeNumber }) {
      const res = await fetch(`${cfg.apiBaseUrl}/receivables/v1/payid/registerpayid`, {
        method: "POST",
        headers: monoovaHeaders(cfg.apiKey),
        body: JSON.stringify({
          bankAccountNumber: cfg.bankAccountNumber.padStart(9, "0"),
          bsb: cfg.bsb,
          payIdName: `${payIdNamePrefix} ${noticeNumber}`,
          // Blank → Monoova auto-generates a check-digited PayID on @monoova.me.
          payId: "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as MonoovaPayIdResponse;
      const payId = data.PayIdDetails?.PayId ?? data.PayId;
      if (!res.ok || data.status !== "Ok" || !payId) {
        throw new Error(
          `Monoova PayID registration failed for ${noticeNumber} (HTTP ${res.status}): ${JSON.stringify(data)}`,
        );
      }
      return payId;
    },

    verifyWebhook(rawBody, signature) {
      if (!signature || !publicKey) return false;
      const key = publicKey;
      const verifyWith = (encoding: "base64" | "hex") => {
        try {
          return createVerify("RSA-SHA256")
            .update(rawBody, "utf8")
            .verify(key, signature, encoding);
        } catch {
          return false;
        }
      };
      // Monoova sends base64; accept hex too so a test harness can't be tripped
      // up by encoding choice.
      return verifyWith("base64") || verifyWith("hex");
    },

    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      // Two observed shapes: the flat PascalCase NPP status payload, and the
      // nested { eventName, eventId, timestamp, data:{...} } receive-payment
      // envelope. Read whichever fields are present.
      const data = (typeof body.data === "object" && body.data ? body.data : body) as Record<
        string,
        unknown
      >;
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const v = data[k] ?? body[k];
          if (v !== undefined && v !== null && v !== "") return v;
        }
        return undefined;
      };

      const providerRef = String(
        pick("TransactionId", "transactionId", "paymentId", "PaymentId", "eventId") ?? randomUUID(),
      );
      const payidRaw = pick("PayId", "payId");
      const paidAt =
        pick("DateTime", "dateTime", "timestamp") ??
        (typeof body.timestamp === "string" ? body.timestamp : undefined) ??
        new Date().toISOString();
      const payerName = pick("RemitterName", "remitterName", "payerName");

      return {
        providerRef,
        payid: payidRaw != null ? String(payidRaw) : null,
        amountCents: monoovaAmountToCents(pick("Amount", "amount")),
        paidAt: String(paidAt),
        payerName: payerName != null ? String(payerName) : null,
        raw: body,
      };
    },
  };
}
