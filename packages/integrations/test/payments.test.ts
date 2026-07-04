import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationsFromEnv } from "../src/index.js";
import { mockPaymentsProvider, monoovaPaymentsProvider } from "../src/payments.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mockPaymentsProvider", () => {
  const provider = mockPaymentsProvider("test-secret");

  it("provisions a deterministic, DISTINCT account per scheme", async () => {
    const a = await provider.createSchemeAccount({
      schemeId: "11111111-2222-3333-4444-555555555555",
    });
    const b = await provider.createSchemeAccount({
      schemeId: "99999999-8888-7777-6666-000000000042",
    });
    expect(a.accountNumber).not.toBe(b.accountNumber);
    expect(a.payidRoot).toContain("@goodstrata.mock");
    // Re-provisioning is stable.
    const a2 = await provider.createSchemeAccount({
      schemeId: "11111111-2222-3333-4444-555555555555",
    });
    expect(a2).toEqual(a);
  });

  it("scopes payment references UNDER the scheme's own account", async () => {
    const account = await provider.createSchemeAccount({ schemeId: "s-1" });
    const ref = await provider.createPaymentReference({
      schemeId: "s-1",
      noticeNumber: "LN-2026-01-1",
      account,
    });
    expect(ref).toContain(account.providerAccountId);
    expect(ref).toContain("ln-2026-01-1");
  });

  it("verifies its own HMAC signature and rejects tampering", () => {
    const body = provider.buildWebhookBody({
      payid: "gs-1",
      amountCents: 12_300,
      paidAt: "2026-06-01T00:00:00Z",
      payerName: "Sam",
    });
    const sig = provider.sign(body);
    expect(provider.verifyWebhook(body, sig)).toBe(true);
    expect(provider.verifyWebhook(`${body} `, sig)).toBe(false);
    expect(provider.verifyWebhook(body, undefined)).toBe(false);
    expect(provider.verifyWebhook(body, "deadbeef")).toBe(false); // wrong length
  });

  it("parses its webhook body into a normalized inbound payment", () => {
    const body = provider.buildWebhookBody({
      providerRef: "mock-ref-1",
      payid: "gs-1",
      amountCents: 12_300,
      accountNumber: "123456789",
      paidAt: "2026-06-01T00:00:00Z",
      payerName: "Sam",
    });
    const parsed = provider.parseWebhook(body);
    expect(parsed).toMatchObject({
      providerRef: "mock-ref-1",
      payid: "gs-1",
      amountCents: 12_300,
      currency: "AUD",
      accountNumber: "123456789",
      payerName: "Sam",
    });
  });
});

describe("monoovaPaymentsProvider webhook verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const hexDer = publicKey.export({ type: "pkcs1", format: "der" }).toString("hex");
  const cfg = {
    apiBaseUrl: "https://api.example",
    apiKey: "k",
    bankAccountNumber: "62220000",
    bsb: "802-985",
  };
  const body = JSON.stringify({ TransactionId: "T1", Amount: "150.00", PayId: "x@monoova.me" });
  const sign = (encoding: "base64" | "hex") =>
    createSign("RSA-SHA256").update(body, "utf8").sign(privateKey, encoding);

  it("fails CLOSED when no public key is configured", () => {
    const provider = monoovaPaymentsProvider(cfg);
    expect(provider.verifyWebhook(body, sign("base64"))).toBe(false);
  });

  it("fails CLOSED when the key material is invalid", () => {
    const provider = monoovaPaymentsProvider({ ...cfg, webhookPublicKey: "not-a-key" });
    expect(provider.verifyWebhook(body, sign("base64"))).toBe(false);
  });

  it("verifies RSA-SHA256 signatures with a PEM key (base64 and hex encodings)", () => {
    const provider = monoovaPaymentsProvider({ ...cfg, webhookPublicKey: pem });
    expect(provider.verifyWebhook(body, sign("base64"))).toBe(true);
    expect(provider.verifyWebhook(body, sign("hex"))).toBe(true);
    expect(provider.verifyWebhook(`${body} `, sign("base64"))).toBe(false);
    expect(provider.verifyWebhook(body, undefined)).toBe(false);
  });

  it("accepts the hex-DER (PKCS#1) key shape served by the certificate endpoint", () => {
    const provider = monoovaPaymentsProvider({ ...cfg, webhookPublicKey: hexDer });
    expect(provider.verifyWebhook(body, sign("base64"))).toBe(true);
    expect(provider.verifyWebhook(body.replace("150.00", "999.00"), sign("base64"))).toBe(false);
  });
});

describe("monoovaPaymentsProvider webhook parsing", () => {
  const provider = monoovaPaymentsProvider({
    apiBaseUrl: "https://api.example",
    apiKey: "k",
    bankAccountNumber: "62220000",
    bsb: "802-985",
  });

  it("parses the flat PascalCase NPP payload, converting dollars to cents", () => {
    const parsed = provider.parseWebhook(
      JSON.stringify({
        TransactionId: "TXN-1",
        PayId: "0400123456@monoova.me",
        Amount: "150.75",
        Currency: "aud",
        DateTime: "2026-06-01T10:00:00Z",
        RemitterName: "Sam Shopkeeper",
        BankAccountNumber: "629999001",
      }),
    );
    expect(parsed).toMatchObject({
      providerRef: "TXN-1",
      payid: "0400123456@monoova.me",
      amountCents: 15_075,
      currency: "AUD",
      accountNumber: "629999001",
      paidAt: "2026-06-01T10:00:00Z",
      payerName: "Sam Shopkeeper",
    });
  });

  it("parses the nested receive-payment envelope", () => {
    const parsed = provider.parseWebhook(
      JSON.stringify({
        eventName: "NPPReceivePayment",
        eventId: "EV-9",
        timestamp: "2026-06-02T00:00:00Z",
        data: {
          transactionId: "TXN-2",
          payId: "0400777777@monoova.me",
          amount: 88.05,
          bankAccountNumber: "629999002",
          remitterName: "Alex Owner",
        },
      }),
    );
    expect(parsed).toMatchObject({
      providerRef: "TXN-2",
      payid: "0400777777@monoova.me",
      amountCents: 8_805,
      accountNumber: "629999002",
      payerName: "Alex Owner",
    });
  });

  it("yields NaN cents for garbage amounts (rejected downstream, never booked)", () => {
    const parsed = provider.parseWebhook(JSON.stringify({ TransactionId: "T", Amount: "lots" }));
    expect(Number.isNaN(parsed.amountCents)).toBe(true);
  });
});

describe("monoovaPaymentsProvider API calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cfg = {
    apiBaseUrl: "https://api.example",
    apiKey: "secret-key",
    bankAccountNumber: "62220000",
    bsb: "802-985",
  };

  it("creates the scheme's own mAccount and returns its details", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        status: "Ok",
        Token: "mAcct-1",
        AccountNumber: "629999001",
        BsbNumber: "802-985",
      }),
    );
    vi.stubGlobal("fetch", fetchFn);

    const provider = monoovaPaymentsProvider(cfg);
    const account = await provider.createSchemeAccount({ schemeId: "scheme-1" });
    expect(account).toEqual({
      providerAccountId: "mAcct-1",
      bsb: "802-985",
      accountNumber: "629999001",
    });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/financial/v2/accounts/create");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("secret-key:").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      uniqueReference: "scheme-1",
      nppEnabled: true,
    });
  });

  it("throws with detail when account creation fails (blocked provisioning)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ status: "Error", statusDescription: "banking partner rejected" }, 400),
      ),
    );
    const provider = monoovaPaymentsProvider(cfg);
    await expect(provider.createSchemeAccount({ schemeId: "scheme-1" })).rejects.toThrow(
      /Monoova account creation failed .* 400/,
    );
  });

  it("registers a PayID under the SCHEME's account, not the master pool", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ status: "Ok", PayIdDetails: { PayId: "0400123456@monoova.me" } }),
    );
    vi.stubGlobal("fetch", fetchFn);

    const provider = monoovaPaymentsProvider(cfg);
    const payid = await provider.createPaymentReference({
      schemeId: "scheme-1",
      noticeNumber: "LN-2026-01-1",
      account: { providerAccountId: "mAcct-1", bsb: "802-985", accountNumber: "629999001" },
    });
    expect(payid).toBe("0400123456@monoova.me");

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.bankAccountNumber).toBe("629999001"); // the scheme's own account
    expect(sent.payIdName).toContain("LN-2026-01-1");
  });

  it("throws with detail when PayID registration fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "Error", statusDescription: "PayID limit" }, 400)),
    );
    const provider = monoovaPaymentsProvider(cfg);
    await expect(
      provider.createPaymentReference({
        schemeId: "scheme-1",
        noticeNumber: "LN-2026-01-1",
        account: { providerAccountId: "mAcct-1", bsb: "802-985", accountNumber: "629999001" },
      }),
    ).rejects.toThrow(/Monoova PayID registration failed/);
  });
});

describe("integrationsFromEnv payments selection", () => {
  it("selects monoova when configured and fails fast on missing config", () => {
    const integrations = integrationsFromEnv({
      PAYMENTS_PROVIDER: "monoova",
      MONOOVA_API_KEY: "k",
      MONOOVA_BANK_ACCOUNT_NUMBER: "62220000",
    });
    expect(integrations.payments.name).toBe("monoova");
    expect(integrations.payments.signatureHeader).toBe("verification-signature");

    expect(() => integrationsFromEnv({ PAYMENTS_PROVIDER: "monoova" })).toThrow(
      /requires MONOOVA_API_KEY/,
    );
  });

  it("defaults to the mock provider", () => {
    expect(integrationsFromEnv({}).payments.name).toBe("mock");
  });
});
