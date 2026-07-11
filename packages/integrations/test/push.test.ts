import { describe, expect, it, vi } from "vitest";
import { integrationsFromEnv } from "../src/index.js";
import { expoPushProvider, memoryPushProvider, type OutboundPush } from "../src/push.js";

function ticketResponse(tickets: unknown[]): Response {
  return new Response(JSON.stringify({ data: tickets }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function receiptResponse(receipts: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data: receipts }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function msg(to: string): OutboundPush {
  return { to, title: "Decision requested", body: "A decision needs your vote." };
}

describe("expoPushProvider", () => {
  it("POSTs the message batch to the Expo push endpoint", async () => {
    const fetchFn = vi.fn(async () => ticketResponse([{ status: "ok", id: "t-1" }]));
    const provider = expoPushProvider({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(provider.name).toBe("expo");

    const out = await provider.send([
      {
        to: "ExponentPushToken[aaa]",
        title: "Levy notice",
        body: "Due 2026-08-01.",
        data: { schemeId: "s-1", related: { type: "levy_notice", id: "n-1" } },
      },
    ]);
    expect(out.invalidTokens).toEqual([]);
    expect(out.receiptTickets).toEqual([{ receiptId: "t-1", token: "ExponentPushToken[aaa]" }]);
    expect(out.processedTokens).toEqual(["ExponentPushToken[aaa]"]);
    expect(out.retryTokens).toEqual([]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(init.body)) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      to: "ExponentPushToken[aaa]",
      title: "Levy notice",
      body: "Due 2026-08-01.",
      sound: "default",
      channelId: "default",
      data: { schemeId: "s-1", related: { type: "levy_notice", id: "n-1" } },
    });
  });

  it("sends the EXPO_ACCESS_TOKEN bearer when configured", async () => {
    const fetchFn = vi.fn(async () => ticketResponse([{ status: "ok", id: "t-1" }]));
    const provider = expoPushProvider({
      accessToken: "expo-secret",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await provider.send([msg("ExponentPushToken[aaa]")]);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer expo-secret");
  });

  it("chunks batches over 100 messages into multiple requests", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) =>
      ticketResponse(
        (JSON.parse(String(init.body)) as unknown[]).map((_m, i) => ({
          status: "ok",
          id: `t-${i}`,
        })),
      ),
    );
    const provider = expoPushProvider({ fetchFn: fetchFn as unknown as typeof fetch });

    const messages = Array.from({ length: 205 }, (_, i) => msg(`ExponentPushToken[${i}]`));
    const out = await provider.send(messages);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const sizes = fetchFn.mock.calls.map(
      (c) =>
        (JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as unknown[]).length,
    );
    expect(sizes).toEqual([100, 100, 5]);
    expect(out.processedTokens).toHaveLength(205);
    expect(out.retryTokens).toEqual([]);
  });

  it("surfaces DeviceNotRegistered tokens (and only those) as invalidTokens", async () => {
    const fetchFn = vi.fn(async () =>
      ticketResponse([
        { status: "ok", id: "t-1" },
        {
          status: "error",
          message: "not a registered push notification recipient",
          details: { error: "DeviceNotRegistered" },
        },
        { status: "error", message: "too big", details: { error: "MessageTooBig" } },
      ]),
    );
    const provider = expoPushProvider({ fetchFn: fetchFn as unknown as typeof fetch });

    const out = await provider.send([
      msg("ExponentPushToken[alive]"),
      msg("ExponentPushToken[dead]"),
      msg("ExponentPushToken[chunky]"),
    ]);
    // The dead token is reported for pruning; other ticket errors only log.
    expect(out.invalidTokens).toEqual(["ExponentPushToken[dead]"]);
  });

  it("maps receipt-only DeviceNotRegistered errors back to the token", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        ticketResponse([
          { status: "ok", id: "receipt-alive" },
          { status: "ok", id: "receipt-dead" },
          { status: "ok", id: "receipt-pending" },
        ]),
      )
      .mockResolvedValueOnce(
        receiptResponse({
          "receipt-alive": { status: "ok" },
          "receipt-dead": {
            status: "error",
            message: "not a registered push notification recipient",
            details: { error: "DeviceNotRegistered" },
          },
          // receipt-pending is intentionally omitted: Expo does this until a
          // receipt becomes available, so the caller must retain it to retry.
        }),
      );
    const provider = expoPushProvider({ fetchFn: fetchFn as unknown as typeof fetch });

    const sent = await provider.send([
      msg("ExponentPushToken[alive]"),
      msg("ExponentPushToken[receipt-dead]"),
      msg("ExponentPushToken[pending]"),
    ]);
    expect(sent.invalidTokens).toEqual([]); // all send tickets were accepted
    expect(sent.receiptTickets).toHaveLength(3);

    const checked = await provider.checkReceipts!(sent.receiptTickets);
    expect(checked.invalidTokens).toEqual(["ExponentPushToken[receipt-dead]"]);
    expect(checked.processedReceiptIds.sort()).toEqual(["receipt-alive", "receipt-dead"].sort());

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/getReceipts");
    expect(JSON.parse(String(init.body))).toEqual({
      ids: ["receipt-alive", "receipt-dead", "receipt-pending"],
    });
  });

  it("returns a request-level failure as retryable progress", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const provider = expoPushProvider({ fetchFn: fetchFn as unknown as typeof fetch });
    const out = await provider.send([msg("ExponentPushToken[aaa]")]);
    expect(out.processedTokens).toEqual([]);
    expect(out.retryTokens).toEqual(["ExponentPushToken[aaa]"]);
    expect(out.error).toMatch(/expo-push: send failed \(429\): rate limited/);
  });

  it("preserves successful earlier chunks and returns the failed + unsent tail", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) =>
        ticketResponse(
          (JSON.parse(String(init.body)) as unknown[]).map((_message, index) => ({
            status: "ok",
            id: `accepted-${index}`,
          })),
        ),
      )
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const provider = expoPushProvider({ fetchFn: fetchFn as unknown as typeof fetch });
    const messages = Array.from({ length: 205 }, (_, i) => msg(`ExponentPushToken[${i}]`));

    const out = await provider.send(messages);

    expect(fetchFn).toHaveBeenCalledTimes(2); // third chunk was never attempted
    expect(out.receiptTickets).toHaveLength(100);
    expect(out.processedTokens).toEqual(messages.slice(0, 100).map((message) => message.to));
    expect(out.retryTokens).toEqual(messages.slice(100).map((message) => message.to));
    expect(out.error).toContain("rate limited");
  });
});

describe("memoryPushProvider", () => {
  it("records sends and reports configured dead tokens as invalid", async () => {
    const provider = memoryPushProvider();
    provider.deadTokens.add("ExponentPushToken[dead]");

    const out = await provider.send([msg("ExponentPushToken[ok]"), msg("ExponentPushToken[dead]")]);
    expect(provider.sent.map((m) => m.to)).toEqual([
      "ExponentPushToken[ok]",
      "ExponentPushToken[dead]",
    ]);
    expect(out.invalidTokens).toEqual(["ExponentPushToken[dead]"]);
  });
});

describe("integrationsFromEnv push selection", () => {
  it("defaults to console, selects memory and expo by PUSH_PROVIDER", () => {
    expect(integrationsFromEnv({}).push.name).toBe("console");
    expect(integrationsFromEnv({ PUSH_PROVIDER: "memory" }).push.name).toBe("memory");
    expect(integrationsFromEnv({ PUSH_PROVIDER: "expo" }).push.name).toBe("expo");
  });
});
