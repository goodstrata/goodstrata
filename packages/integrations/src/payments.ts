import {
  createHmac,
  createPublicKey,
  createVerify,
  type KeyObject,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

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
  /** ISO currency code when the provider reports one (NPP is always AUD). */
  currency?: string | null;
  /**
   * Destination account number the money landed in (the scheme's own virtual
   * collection account). Lets reconciliation attribute the scheme even when
   * the payment reference is unknown/typo'd, so the money can be parked as
   * unmatched instead of dropped.
   */
  accountNumber?: string | null;
  paidAt: string; // ISO timestamp
  payerName: string | null;
  raw: unknown;
}

/**
 * A scheme's OWN segregated collection account (OC Act s 122). Every PayID for
 * that scheme's levy notices is registered UNDER this account, never a shared
 * platform pool — this is the on-the-wire half of per-OC trust segregation.
 */
export interface SchemeAccount {
  /** Provider's opaque id for the account (used for later API calls). */
  providerAccountId: string;
  /** e.g. 802-985. */
  bsb: string;
  /** The account number PayIDs resolve to; unique per scheme. */
  accountNumber: string;
  /** PayID root for the per-OC virtual collection account, when issued. */
  payidRoot?: string | null;
}

export interface PaymentsProvider {
  readonly name: string;
  /**
   * HTTP header the webhook route should read the signature from and hand to
   * `verifyWebhook`. Defaults to `x-signature` (the mock provider) when unset;
   * Monoova signs via `verification-signature`.
   */
  readonly signatureHeader?: string;
  /**
   * Provision the owners corporation's OWN segregated collection account
   * (OC Act s 122). Distinct per scheme — a registered manager may never pool
   * OCs' money in one shared account.
   */
  createSchemeAccount(input: { schemeId: string }): Promise<SchemeAccount>;
  /**
   * Allocate a unique payment reference (PayID) for a levy notice, registered
   * UNDER the scheme's own trust account (`account`) — never a shared pool.
   */
  createPaymentReference(input: {
    schemeId: string;
    noticeNumber: string;
    account: SchemeAccount;
  }): Promise<string>;
  /** Verify webhook authenticity. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  /** Parse a verified webhook body into a normalized inbound payment. */
  parseWebhook(rawBody: string): InboundPayment;
}

/**
 * The money-critical shape of a mock webhook body. `providerRef` is the
 * idempotency key and `amountCents` feeds ledger reconciliation, so both are
 * required and typed — a typo'd/missing field is rejected, never coerced.
 */
const mockWebhookBodySchema = z.object({
  providerRef: z.string().min(1),
  payid: z.string().nullish(),
  amountCents: z.number().int(),
  currency: z.string().nullish(),
  accountNumber: z.string().nullish(),
  paidAt: z.string().min(1),
  payerName: z.string().nullish(),
});

function parseMockWebhookBody(rawBody: string): z.infer<typeof mockWebhookBodySchema> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error("mock payments webhook: body is not valid JSON");
  }
  const result = mockWebhookBodySchema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`mock payments webhook: malformed payload — ${detail}`);
  }
  return result.data;
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
    async createSchemeAccount({ schemeId }) {
      // Deterministic per scheme so tests (and re-provisioning) are stable, yet
      // every scheme gets a DISTINCT account — no shared pool.
      const digits = schemeId.replace(/\D/g, "").padStart(9, "0").slice(-9);
      return {
        providerAccountId: `mock-acct-${schemeId}`,
        bsb: "802-985",
        accountNumber: digits,
        payidRoot: `oc.${digits}@goodstrata.mock`,
      };
    },
    async createPaymentReference({ noticeNumber, account }) {
      // The reference lives UNDER the scheme's own account: encode the account
      // so two schemes reusing a notice number can never collide on the PayID.
      return `mockpay-${account.providerAccountId}-${noticeNumber.toLowerCase()}`;
    },
    verifyWebhook(rawBody, signature) {
      if (!signature) return false;
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    parseWebhook(rawBody) {
      // Signature verification proves the SENDER; it says nothing about the
      // SHAPE. Validate the money-critical fields before any of them reach
      // reconciliation — a missing amountCents / providerRef (the idempotency
      // key) must fail loud here, not silently book undefined/NaN.
      const body = parseMockWebhookBody(rawBody);
      return {
        providerRef: body.providerRef,
        payid: body.payid ?? null,
        amountCents: body.amountCents,
        currency: body.currency ?? null,
        accountNumber: body.accountNumber ?? null,
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
        currency: input.currency ?? "AUD",
        accountNumber: input.accountNumber ?? null,
        paidAt: input.paidAt,
        payerName: input.payerName,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Monoova (NPP / PayID) — the real driver.
//
// Per-OC model (OC Act s 122): each owners corporation gets its OWN virtual
// collection account (`createSchemeAccount`), and every PayID for that scheme's
// levy notices is registered UNDER that account (`createPaymentReference`). The
// platform NPP account (`bankAccountNumber`) is only the master/funding account
// the virtual accounts hang off — OCs' money is never pooled into it.
// Reconciliation remains by the unique PayID string, which now resolves to the
// scheme's own account — exactly what recordInboundPayment matches on.
//
// Verified against the live API (https://api.m-pay.com.au):
//   - Auth: Basic base64(`${apiKey}:`) — API key as username, empty password.
//   - POST /financial/v2/accounts/create → a per-OC mAccount (virtual collection
//       account) with its own BsbNumber + AccountNumber.
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
  /** Master/funding NPP account the per-OC virtual accounts hang off. */
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

interface MonoovaAccountResponse {
  status?: string;
  statusDescription?: string;
  /** Monoova returns the new mAccount under a few observed shapes. */
  Token?: string;
  AccountNumber?: string;
  BankAccountNumber?: string;
  BsbNumber?: string;
  Bsb?: string;
  mAccount?: {
    Token?: string;
    AccountNumber?: string;
    BsbNumber?: string;
  } | null;
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

    async createSchemeAccount({ schemeId }) {
      // Create the OC's own virtual collection account (mAccount). PayIDs for
      // this scheme's levies register under it, so its money never pools into
      // the platform master account.
      const res = await fetch(`${cfg.apiBaseUrl}/financial/v2/accounts/create`, {
        method: "POST",
        headers: monoovaHeaders(cfg.apiKey),
        body: JSON.stringify({
          accountType: "Automatcher",
          nppEnabled: true,
          uniqueReference: schemeId,
          accountName: `GoodStrata OC ${schemeId}`,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as MonoovaAccountResponse;
      const providerAccountId = data.Token ?? data.mAccount?.Token;
      const accountNumber =
        data.AccountNumber ?? data.BankAccountNumber ?? data.mAccount?.AccountNumber;
      const bsb = data.BsbNumber ?? data.Bsb ?? data.mAccount?.BsbNumber ?? cfg.bsb;
      if (
        !res.ok ||
        (data.status && data.status !== "Ok") ||
        !providerAccountId ||
        !accountNumber
      ) {
        throw new Error(
          `Monoova account creation failed for scheme ${schemeId} (HTTP ${res.status}): ${JSON.stringify(data)}`,
        );
      }
      return { providerAccountId, bsb, accountNumber };
    },

    async createPaymentReference({ noticeNumber, account }) {
      const res = await fetch(`${cfg.apiBaseUrl}/receivables/v1/payid/registerpayid`, {
        method: "POST",
        headers: monoovaHeaders(cfg.apiKey),
        body: JSON.stringify({
          // Register the PayID against the SCHEME's own account, not the pool.
          bankAccountNumber: account.accountNumber.padStart(9, "0"),
          bsb: account.bsb,
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
      // Destination mAccount the money landed in — attributes the scheme even
      // when the PayID is unknown (typo'd reference on a direct transfer).
      const accountRaw = pick(
        "BankAccountNumber",
        "bankAccountNumber",
        "AccountNumber",
        "accountNumber",
        "ToAccountNumber",
      );
      const currencyRaw = pick("Currency", "currency", "CurrencyCode");

      return {
        providerRef,
        payid: payidRaw != null ? String(payidRaw) : null,
        amountCents: monoovaAmountToCents(pick("Amount", "amount")),
        currency: currencyRaw != null ? String(currencyRaw).toUpperCase() : null,
        accountNumber: accountRaw != null ? String(accountRaw) : null,
        paidAt: String(paidAt),
        payerName: payerName != null ? String(payerName) : null,
        raw: body,
      };
    },
  };
}
