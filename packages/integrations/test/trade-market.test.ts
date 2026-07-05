import { describe, expect, it } from "vitest";
import { memoryEmailProvider } from "../src/email.js";
import { integrationsFromEnv, tradeMarketByName } from "../src/index.js";
import {
  consoleTradeMarketProvider,
  emailRfqTradeMarketProvider,
  type NormalizedQuote,
  type RfqPosting,
  schemeBookTradeMarketProvider,
} from "../src/tradeMarket.js";

const posting: RfqPosting = {
  rfqId: "0197a000-0000-7000-8000-000000000001",
  title: "Repair leaking common-area roof",
  scopeMd: "- Inspect box gutter\n- Replace damaged flashing\n- Certify waterproofing",
  category: "roofing",
  suburb: "Brunswick",
  buildingType: "3-storey walk-up",
  quotesDueOn: "2026-07-20",
  replyRef: "rfq-replies+0197a000@goodstrata.example",
};

describe("schemeBookTradeMarketProvider", () => {
  it("emails the posting to each scheme-book contractor via the injected EmailProvider", async () => {
    const email = memoryEmailProvider();
    const provider = schemeBookTradeMarketProvider(email);
    expect(provider.name).toBe("scheme_book");
    expect(provider.capabilities()).toEqual({
      requiresRecipients: true,
      canFetchQuotes: false,
      supportsWebhooks: false,
    });

    const { externalRef } = await provider.postJob({
      posting,
      recipients: [
        { email: "plumber@example.com", businessName: "Pipes Pty Ltd" },
        { email: "roofer@example.com", businessName: "Roofs R Us" },
      ],
    });
    expect(externalRef).toMatch(/^scheme-book-0197a000-0000-7000-8000-000000000001-[0-9a-f]{12}$/);

    expect(email.sent).toHaveLength(2);
    expect(email.sent.map((e) => e.to)).toEqual(["plumber@example.com", "roofer@example.com"]);
    const body = email.sent[0]!;
    expect(body.subject).toBe("Quote requested: Repair leaking common-area roof");
    expect(body.text).toContain("Brunswick");
    expect(body.text).toContain("roofing");
    expect(body.text).toContain("3-storey walk-up");
    expect(body.text).toContain("Replace damaged flashing");
    expect(body.text).toContain(posting.replyRef);
  });

  it("carries ONLY the anonymized posting — no address, lot or person data can appear", async () => {
    const email = memoryEmailProvider();
    const provider = schemeBookTradeMarketProvider(email);
    await provider.postJob({
      posting,
      recipients: [{ email: "tradie@example.com" }],
    });
    const text = `${email.sent[0]!.subject}\n${email.sent[0]!.text}`;
    // The body is rendered from RfqPosting alone; assert nothing beyond its
    // fields leaked in (suburb yes; street/lot/owner shapes structurally absent).
    expect(text).toContain("Brunswick");
    expect(text).not.toMatch(/\d+\s+\w+\s+(St|Street|Rd|Road|Ave|Avenue)\b/i);
    expect(text).not.toMatch(/lot\s*\d+/i);
    expect(text).toContain("address is shared with the successful contractor");
  });

  it("is deterministic per rfq + recipient set and requires recipients", async () => {
    const email = memoryEmailProvider();
    const provider = schemeBookTradeMarketProvider(email);
    const first = await provider.postJob({
      posting,
      recipients: [{ email: "b@example.com" }, { email: "A@example.com" }],
    });
    const second = await provider.postJob({
      posting,
      recipients: [{ email: "a@example.com" }, { email: "b@example.com" }],
    });
    // Case/order-insensitive over recipient emails — retries can't fork a new ref.
    expect(second.externalRef).toBe(first.externalRef);

    await expect(provider.postJob({ posting })).rejects.toThrow(/requires at least one recipient/);
    await expect(provider.postJob({ posting, recipients: [] })).rejects.toThrow(
      /requires at least one recipient/,
    );
  });

  it("returns no quotes from polling (replies are recorded manually)", async () => {
    const provider = schemeBookTradeMarketProvider(memoryEmailProvider());
    expect(await provider.fetchQuotes("scheme-book-anything")).toEqual([]);
  });
});

describe("emailRfqTradeMarketProvider", () => {
  it("emails invited addresses with the tracking token in the subject", async () => {
    const email = memoryEmailProvider();
    const provider = emailRfqTradeMarketProvider(email);
    expect(provider.name).toBe("email_rfq");
    expect(provider.capabilities()).toEqual({
      requiresRecipients: true,
      canFetchQuotes: false,
      supportsWebhooks: false,
    });

    const { externalRef } = await provider.postJob({
      posting,
      recipients: [{ email: "invited-1@example.com" }, { email: "invited-2@example.com" }],
    });
    expect(externalRef).toMatch(/^email-rfq-0197a000-0000-7000-8000-000000000001-[0-9a-f]{12}$/);

    expect(email.sent).toHaveLength(2);
    for (const sent of email.sent) {
      // The token IS the external ref — a reply's subject routes back to the RFQ.
      expect(sent.subject).toBe(
        `[GS-RFQ ${externalRef}] Quote requested: Repair leaking common-area roof`,
      );
      expect(sent.text).toContain("Brunswick");
      expect(sent.text).toContain(posting.replyRef);
    }
  });

  it("requires invited emails and returns no quotes from polling", async () => {
    const provider = emailRfqTradeMarketProvider(memoryEmailProvider());
    await expect(provider.postJob({ posting })).rejects.toThrow(
      /requires at least one invited email/,
    );
    expect(await provider.fetchQuotes("email-rfq-anything")).toEqual([]);
  });
});

describe("consoleTradeMarketProvider", () => {
  it("captures postings and serves quote fixtures via setQuotes", async () => {
    const provider = consoleTradeMarketProvider();
    expect(provider.name).toBe("console");
    expect(provider.capabilities()).toEqual({
      requiresRecipients: false,
      canFetchQuotes: true,
      supportsWebhooks: false,
    });

    const { externalRef } = await provider.postJob({ posting });
    expect(externalRef).toBe(`console-${posting.rfqId}`);
    expect(provider.posted).toHaveLength(1);
    expect(provider.posted[0]!.posting).toEqual(posting);
    expect(provider.posted[0]!.recipients).toEqual([]);

    expect(await provider.fetchQuotes(externalRef)).toEqual([]);

    const quote: NormalizedQuote = {
      providerRef: "console-quote-1",
      rfqId: posting.rfqId,
      amountCents: 480_000,
      businessName: "Roofs R Us",
      abn: "12 345 678 901",
      contactEmail: "roofer@example.com",
      contactPhone: null,
      validUntil: "2026-08-01",
      notes: "Includes scaffolding",
      licenceConfirmed: true,
      insuranceConfirmed: true,
      platformFeeCents: 5_000,
      referralFeeCents: 0,
      feeRecipient: "Console Marketplace Pty Ltd",
      raw: { source: "fixture" },
    };
    provider.setQuotes(externalRef, [quote]);
    expect(await provider.fetchQuotes(externalRef)).toEqual([quote]);
    expect(await provider.fetchQuotes("console-other")).toEqual([]);
  });
});

describe("integrationsFromEnv trade-market selection", () => {
  it("defaults to the scheme book backed by the configured email provider", async () => {
    const integrations = integrationsFromEnv({ EMAIL_PROVIDER: "memory" });
    expect(integrations.tradeMarkets.map((p) => p.name)).toEqual(["scheme_book"]);

    await tradeMarketByName(integrations, "scheme_book").postJob({
      posting,
      recipients: [{ email: "tradie@example.com" }],
    });
    const memoryEmail = integrations.email as ReturnType<typeof memoryEmailProvider>;
    expect(memoryEmail.sent).toHaveLength(1);
    expect(memoryEmail.sent[0]!.to).toBe("tradie@example.com");
  });

  it("enables multiple providers from the CSV and looks them up by name", () => {
    const integrations = integrationsFromEnv({
      EMAIL_PROVIDER: "memory",
      TRADE_MARKET_PROVIDERS: "scheme_book, email_rfq,console",
    });
    expect(integrations.tradeMarkets.map((p) => p.name)).toEqual([
      "scheme_book",
      "email_rfq",
      "console",
    ]);
    expect(tradeMarketByName(integrations, "email_rfq").name).toBe("email_rfq");
    expect(() => tradeMarketByName(integrations, "marketplace_x")).toThrow(
      /trade-market provider "marketplace_x" is not enabled/,
    );
  });

  it("fails fast on an unknown provider name", () => {
    expect(() => integrationsFromEnv({ TRADE_MARKET_PROVIDERS: "hipages" })).toThrow(
      /unknown trade-market provider "hipages"/,
    );
  });
});
