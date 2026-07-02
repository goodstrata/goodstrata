import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import { sesEmailProvider } from "../src/email.js";
import { integrationsFromEnv } from "../src/index.js";
import { twilioSmsProvider } from "../src/sms.js";
import { consoleVideoProvider, dailyVideoProvider } from "../src/video.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sesEmailProvider", () => {
  it("sends Simple content through the injected client", async () => {
    const send = vi.fn(async (_cmd: SendEmailCommand) => ({ MessageId: "ses-msg-1" }));
    const provider = sesEmailProvider({
      region: "ap-southeast-2",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      from: "notices@example.com",
      client: { send },
    });
    expect(provider.name).toBe("ses");

    const result = await provider.send({
      to: "owner@example.com",
      subject: "Levy notice",
      text: "Your levy is due.",
      html: "<p>Your levy is due.</p>",
    });
    expect(result.providerMessageId).toBe("ses-msg-1");

    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0]![0].input;
    expect(input.FromEmailAddress).toBe("notices@example.com");
    expect(input.Destination?.ToAddresses).toEqual(["owner@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBe("Levy notice");
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe("Your levy is due.");
    expect(input.Content?.Simple?.Body?.Html?.Data).toBe("<p>Your levy is due.</p>");
  });

  it("omits the Html part for text-only email", async () => {
    const send = vi.fn(async (_cmd: SendEmailCommand) => ({ MessageId: "ses-msg-2" }));
    const provider = sesEmailProvider({
      region: "ap-southeast-2",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      from: "notices@example.com",
      client: { send },
    });
    await provider.send({ to: "a@example.com", subject: "Hi", text: "Plain" });
    const input = send.mock.calls[0]![0].input;
    expect(input.Content?.Simple?.Body?.Html).toBeUndefined();
  });
});

describe("twilioSmsProvider", () => {
  it("POSTs a form-encoded message with Basic auth", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM123" }, 201));
    const provider = twilioSmsProvider({
      accountSid: "AC_TEST",
      authToken: "token",
      from: "+61400000000",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(provider.name).toBe("twilio");

    const result = await provider.send({ to: "+61411111111", body: "Vote now" });
    expect(result.providerMessageId).toBe("SM123");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_TEST/Messages.json");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("AC_TEST:token").toString("base64")}`);
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(String(init.body));
    expect(params.get("To")).toBe("+61411111111");
    expect(params.get("From")).toBe("+61400000000");
    expect(params.get("Body")).toBe("Vote now");
  });

  it("throws with detail when Twilio rejects the request", async () => {
    const fetchFn = vi.fn(async () => new Response("invalid number", { status: 400 }));
    const provider = twilioSmsProvider({
      accountSid: "AC_TEST",
      authToken: "token",
      from: "+61400000000",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(provider.send({ to: "nope", body: "x" })).rejects.toThrow(
      /twilio: send failed \(400\): invalid number/,
    );
  });
});

describe("dailyVideoProvider", () => {
  it("creates a private room with an expiry", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ name: "gs-abc123", url: "https://acme.daily.co/gs-abc123" }),
    );
    const provider = dailyVideoProvider("daily-key", fetchFn as unknown as typeof fetch);
    expect(provider.name).toBe("daily");

    const before = Math.floor(Date.now() / 1000);
    const room = await provider.createRoom({ name: "gs-abc123", expiresMinutes: 60 });
    expect(room).toEqual({ url: "https://acme.daily.co/gs-abc123", roomName: "gs-abc123" });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.daily.co/v1/rooms");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer daily-key");
    const body = JSON.parse(String(init.body));
    expect(body.name).toBe("gs-abc123");
    expect(body.privacy).toBe("private");
    expect(body.properties.exp).toBeGreaterThanOrEqual(before + 60 * 60);
    expect(body.properties.exp).toBeLessThanOrEqual(before + 60 * 60 + 5);
  });

  it("mints meeting tokens bound to the room", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token: "jwt-token" }));
    const provider = dailyVideoProvider("daily-key", fetchFn as unknown as typeof fetch);

    const out = await provider.createMeetingToken({
      roomName: "gs-abc123",
      userName: "Alex Chen",
      isOwner: true,
    });
    expect(out.token).toBe("jwt-token");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.daily.co/v1/meeting-tokens");
    const body = JSON.parse(String(init.body));
    expect(body.properties.room_name).toBe("gs-abc123");
    expect(body.properties.user_name).toBe("Alex Chen");
    expect(body.properties.is_owner).toBe(true);
    expect(body.properties.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("throws with detail when the API errors", async () => {
    const fetchFn = vi.fn(async () => new Response("room exists", { status: 400 }));
    const provider = dailyVideoProvider("daily-key", fetchFn as unknown as typeof fetch);
    await expect(provider.createRoom({ name: "dup", expiresMinutes: 10 })).rejects.toThrow(
      /daily: POST \/rooms failed \(400\)/,
    );
  });
});

describe("integrationsFromEnv provider selection", () => {
  it("selects ses / twilio / daily when configured", () => {
    const integrations = integrationsFromEnv({
      EMAIL_PROVIDER: "ses",
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "ap-southeast-2",
      AWS_SES_FROM_EMAIL: "from@example.com",
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_PHONE_NUMBER: "+61400000000",
      VIDEO_PROVIDER: "daily",
      DAILY_API_KEY: "dk",
    });
    expect(integrations.email.name).toBe("ses");
    expect(integrations.sms.name).toBe("twilio");
    expect(integrations.video.name).toBe("daily");
  });

  it("falls back to offline drivers and fails fast on missing config", () => {
    const integrations = integrationsFromEnv({});
    expect(integrations.email.name).toBe("console");
    expect(integrations.sms.name).toBe("console");
    expect(integrations.video.name).toBe("console");

    expect(() => integrationsFromEnv({ EMAIL_PROVIDER: "ses" })).toThrow(/requires AWS_REGION/);
    expect(() => integrationsFromEnv({ SMS_PROVIDER: "twilio" })).toThrow(
      /requires TWILIO_ACCOUNT_SID/,
    );
    expect(() => integrationsFromEnv({ VIDEO_PROVIDER: "daily" })).toThrow(
      /requires DAILY_API_KEY/,
    );
  });
});

describe("consoleVideoProvider", () => {
  it("returns deterministic fake rooms and tokens", async () => {
    const provider = consoleVideoProvider();
    const room = await provider.createRoom({ name: "gs-test", expiresMinutes: 10 });
    expect(room.url).toBe("https://video.goodstrata.local/gs-test");
    expect(room.roomName).toBe("gs-test");
    const { token } = await provider.createMeetingToken({
      roomName: "gs-test",
      userName: "Kim Nguyen",
      isOwner: false,
    });
    expect(token).toContain("gs-test");
    expect(token).toContain("Kim_Nguyen");
  });
});
