import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import { type SmtpMessage, sesEmailProvider, smtpEmailProvider } from "../src/email.js";
import { integrationsFromEnv } from "../src/index.js";
import { twilioSmsProvider } from "../src/sms.js";
import { consoleVideoProvider, dailyVideoProvider, flattenVtt } from "../src/video.js";

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
    expect(input.Content?.Simple?.Headers).toBeUndefined();
  });

  it("emits RFC 8058 List-Unsubscribe headers when a URL is supplied", async () => {
    const send = vi.fn(async (_cmd: SendEmailCommand) => ({ MessageId: "ses-msg-3" }));
    const provider = sesEmailProvider({
      region: "ap-southeast-2",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      from: "notices@example.com",
      client: { send },
    });
    await provider.send({
      to: "a@example.com",
      subject: "Hi",
      text: "Plain",
      listUnsubscribeUrl: "https://my.example.com/api/unsubscribe?token=abc",
    });
    const input = send.mock.calls[0]![0].input;
    expect(input.Content?.Simple?.Headers).toEqual([
      { Name: "List-Unsubscribe", Value: "<https://my.example.com/api/unsubscribe?token=abc>" },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ]);
  });

  it("rejects a header-injecting unsubscribe URL before it reaches the provider", async () => {
    const send = vi.fn(async (_cmd: SendEmailCommand) => ({ MessageId: "nope" }));
    const provider = sesEmailProvider({
      region: "ap-southeast-2",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      from: "notices@example.com",
      client: { send },
    });
    await expect(
      provider.send({
        to: "a@example.com",
        subject: "Hi",
        text: "Plain",
        listUnsubscribeUrl: "https://x.example\r\nBcc: victim@example.com",
      }),
    ).rejects.toThrow(/listUnsubscribeUrl/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("smtpEmailProvider", () => {
  it("maps the email and forwards attachments through the injected transport", async () => {
    const sendMail = vi.fn(async (_msg: SmtpMessage) => ({ messageId: "smtp-msg-1" }));
    const provider = smtpEmailProvider({
      host: "smtp.fastmail.com",
      port: 465,
      secure: true,
      user: "notices@example.com",
      pass: "app-password",
      from: "notices@example.com",
      transport: { sendMail },
    });
    expect(provider.name).toBe("smtp");

    const result = await provider.send({
      to: "owner@example.com",
      subject: "Levy notice",
      text: "Your levy is due.",
      html: "<p>Your levy is due.</p>",
      attachments: [
        {
          filename: "notice.pdf",
          content: new Uint8Array([1, 2, 3]),
          contentType: "application/pdf",
        },
      ],
    });
    expect(result.providerMessageId).toBe("smtp-msg-1");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const msg = sendMail.mock.calls[0]![0];
    expect(msg.from).toBe("notices@example.com");
    expect(msg.to).toBe("owner@example.com");
    expect(msg.subject).toBe("Levy notice");
    expect(msg.text).toBe("Your levy is due.");
    expect(msg.html).toBe("<p>Your levy is due.</p>");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0]!.filename).toBe("notice.pdf");
    expect(msg.attachments![0]!.contentType).toBe("application/pdf");
    // Uint8Array is normalised to a Buffer for nodemailer.
    expect(msg.attachments![0]!.content).toEqual(Buffer.from([1, 2, 3]));
  });

  it("omits html and attachments for a plain text-only email", async () => {
    const sendMail = vi.fn(async (_msg: SmtpMessage) => ({ messageId: "smtp-msg-2" }));
    const provider = smtpEmailProvider({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "u",
      pass: "p",
      from: "notices@example.com",
      transport: { sendMail },
    });
    await provider.send({ to: "a@example.com", subject: "Hi", text: "Plain" });
    const msg = sendMail.mock.calls[0]![0];
    expect(msg.html).toBeUndefined();
    expect(msg.attachments).toBeUndefined();
    expect(msg.headers).toBeUndefined();
  });

  it("emits RFC 8058 List-Unsubscribe headers when a URL is supplied", async () => {
    const sendMail = vi.fn(async (_msg: SmtpMessage) => ({ messageId: "smtp-msg-3" }));
    const provider = smtpEmailProvider({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "u",
      pass: "p",
      from: "notices@example.com",
      transport: { sendMail },
    });
    await provider.send({
      to: "a@example.com",
      subject: "Hi",
      text: "Plain",
      listUnsubscribeUrl: "https://my.example.com/api/unsubscribe?token=abc",
    });
    const msg = sendMail.mock.calls[0]![0];
    expect(msg.headers).toEqual({
      "List-Unsubscribe": "<https://my.example.com/api/unsubscribe?token=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
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

  it("selects smtp when configured, reusing AWS_SES_FROM_EMAIL as the sender", () => {
    const integrations = integrationsFromEnv({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.fastmail.com",
      SMTP_PORT: "465",
      SMTP_USER: "notices@example.com",
      SMTP_PASS: "app-password",
      AWS_SES_FROM_EMAIL: "notices@example.com",
    });
    expect(integrations.email.name).toBe("smtp");
  });

  it("falls back to offline drivers and fails fast on missing config", () => {
    const integrations = integrationsFromEnv({});
    expect(integrations.email.name).toBe("console");
    expect(integrations.sms.name).toBe("console");
    expect(integrations.video.name).toBe("console");

    expect(() => integrationsFromEnv({ EMAIL_PROVIDER: "ses" })).toThrow(/requires AWS_REGION/);
    expect(() => integrationsFromEnv({ EMAIL_PROVIDER: "smtp" })).toThrow(/requires SMTP_HOST/);
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

  it("fakes transcription lifecycle with a settable fixture", async () => {
    const provider = consoleVideoProvider();

    expect(await provider.startTranscription("gs-test")).toEqual({ ok: true });
    expect(provider.transcribingRooms.has("gs-test")).toBe(true);

    expect(await provider.fetchTranscriptText("gs-test")).toBeNull();
    provider.setTranscript("gs-test", "Alex: hello\nKim: hi");
    expect(await provider.fetchTranscriptText("gs-test")).toBe("Alex: hello\nKim: hi");
    provider.setTranscript("gs-test", null);
    expect(await provider.fetchTranscriptText("gs-test")).toBeNull();

    expect(await provider.stopTranscription("gs-test")).toEqual({ ok: true });
    expect(provider.transcribingRooms.has("gs-test")).toBe(false);
  });

  it("records chat messages in order", async () => {
    const provider = consoleVideoProvider();
    await provider.sendChatMessage("gs-test", "Welcome everyone", "GoodStrata Chair");
    await provider.sendChatMessage("gs-test", "Item 1: budget", "GoodStrata Chair");
    expect(provider.chatMessages).toEqual([
      { roomName: "gs-test", text: "Welcome everyone", fromName: "GoodStrata Chair" },
      { roomName: "gs-test", text: "Item 1: budget", fromName: "GoodStrata Chair" },
    ]);
  });
});

describe("flattenVtt", () => {
  it("flattens cues to Speaker: text lines and drops metadata", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "",
      "NOTE",
      "generated by daily",
      "",
      "1",
      "00:00:00.000 --> 00:00:04.000",
      "<v Alex Chen>Welcome everyone.</v>",
      "",
      "2",
      "00:00:04.000 --> 00:00:08.000",
      "<v.loud Kim Nguyen>Thanks, <b>happy</b> to be here.</v>",
      "",
      "intro-cue-id",
      "00:00:08.000 --> 00:00:10.000",
      "A plain line without a voice tag",
      "spanning two lines",
    ].join("\n");

    expect(flattenVtt(vtt)).toBe(
      [
        "Alex Chen: Welcome everyone.",
        "Kim Nguyen: Thanks, happy to be here.",
        "A plain line without a voice tag",
        "spanning two lines",
      ].join("\n"),
    );
  });

  it("returns empty string for headers-only input", () => {
    expect(flattenVtt("WEBVTT\n\nNOTE nothing here\n")).toBe("");
  });
});

describe("dailyVideoProvider optional capabilities", () => {
  it("starts and stops transcription without throwing on API errors", async () => {
    const okFetch = vi.fn(async () => jsonResponse({ sent: "true" }));
    const okProvider = dailyVideoProvider("daily-key", okFetch as unknown as typeof fetch);
    expect(await okProvider.startTranscription!("gs-abc")).toEqual({ ok: true });
    expect(await okProvider.stopTranscription!("gs-abc")).toEqual({ ok: true });
    const urls = okFetch.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      "https://api.daily.co/v1/rooms/gs-abc/transcription/start",
      "https://api.daily.co/v1/rooms/gs-abc/transcription/stop",
    ]);

    // Transcription not enabled on the plan → ok:false, never a throw.
    const failFetch = vi.fn(async () => new Response("not enabled", { status: 400 }));
    const failProvider = dailyVideoProvider("daily-key", failFetch as unknown as typeof fetch);
    expect(await failProvider.startTranscription!("gs-abc")).toEqual({ ok: false });
    expect(await failProvider.stopTranscription!("gs-abc")).toEqual({ ok: false });
  });

  it("fetches the latest finished transcript and flattens the WebVTT", async () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:00.000 --> 00:00:04.000",
      "<v Alex Chen>I move we accept the quote.</v>",
    ].join("\n");
    const routes: Record<string, Response | (() => Response)> = {
      "https://api.daily.co/v1/rooms/gs-abc": jsonResponse({ id: "room-1", name: "gs-abc" }),
      "https://api.daily.co/v1/transcript?roomId=room-1": jsonResponse({
        total_count: 3,
        data: [
          { transcriptId: "t-new", status: "t_in_progress", created_at: "2026-01-03T00:00:00Z" },
          {
            transcriptId: "t-2",
            status: "t_finished",
            isVttAvailable: true,
            created_at: "2026-01-02T00:00:00Z",
          },
          {
            transcriptId: "t-1",
            status: "t_finished",
            isVttAvailable: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      "https://api.daily.co/v1/transcript/t-2/access-link": jsonResponse({
        transcriptId: "t-2",
        link: "https://s3.example/t-2.vtt",
      }),
      "https://s3.example/t-2.vtt": new Response(vtt, { status: 200 }),
    };
    const fetchFn = vi.fn(async (url: string) => {
      const hit = routes[url];
      if (!hit) return new Response("not found", { status: 404 });
      return typeof hit === "function" ? hit() : hit;
    });
    const provider = dailyVideoProvider("daily-key", fetchFn as unknown as typeof fetch);

    const text = await provider.fetchTranscriptText!("gs-abc");
    expect(text).toBe("Alex Chen: I move we accept the quote.");
  });

  it("returns null (not a throw) when transcripts are unavailable", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 403 }));
    const provider = dailyVideoProvider("daily-key", fetchFn as unknown as typeof fetch);
    expect(await provider.fetchTranscriptText!("gs-abc")).toBeNull();

    const emptyFetch = vi.fn(async (url: string) =>
      url.endsWith("/rooms/gs-abc")
        ? jsonResponse({ id: "room-1" })
        : jsonResponse({ total_count: 0, data: [] }),
    );
    const emptyProvider = dailyVideoProvider("daily-key", emptyFetch as unknown as typeof fetch);
    expect(await emptyProvider.fetchTranscriptText!("gs-abc")).toBeNull();
  });

  it("broadcasts a Prebuilt-chat-shaped payload plus a plain payload", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ sent: "true" }));
    const provider = dailyVideoProvider("daily-key", fetchFn as unknown as typeof fetch);

    const out = await provider.sendChatMessage!("gs-abc", "Please vote now", "GoodStrata Chair");
    expect(out).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    for (const [url] of calls) {
      expect(url).toBe("https://api.daily.co/v1/rooms/gs-abc/send-app-message");
    }
    const first = JSON.parse(String(calls[0]![1].body));
    expect(first.recipient).toBe("*");
    expect(first.data).toMatchObject({
      event: "chat-msg",
      name: "GoodStrata Chair",
      message: "Please vote now",
    });
    const second = JSON.parse(String(calls[1]![1].body));
    expect(second.data).toEqual({ name: "GoodStrata Chair", message: "Please vote now" });

    // API failure degrades to ok:false.
    const failFetch = vi.fn(async () => new Response("bad", { status: 500 }));
    const failProvider = dailyVideoProvider("daily-key", failFetch as unknown as typeof fetch);
    expect(await failProvider.sendChatMessage!("gs-abc", "x", "Chair")).toEqual({ ok: false });
  });
});
