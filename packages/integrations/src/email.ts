import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { z } from "zod";

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body (always present — accessibility + archival). */
  text: string;
  html?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
  /**
   * Per-recipient one-click unsubscribe URL. When set, SES/SMTP senders emit
   * RFC 8058 `List-Unsubscribe: <url>` + `List-Unsubscribe-Post:
   * List-Unsubscribe=One-Click` headers so inbox providers surface their
   * native unsubscribe affordance.
   */
  listUnsubscribeUrl?: string;
}

const emailAddressSchema = z.string().email();

/**
 * Guard the recipient/header boundary before a message reaches SES or SMTP:
 * a malformed `to` yields an opaque provider 400, and a CR/LF smuggled into
 * `to`/`subject` (or a header-borne URL) is an SMTP header-injection vector.
 * Reject both up front with a message naming the bad field instead of leaking
 * to the provider.
 */
function assertSendableEmail(email: OutboundEmail): void {
  if (!emailAddressSchema.safeParse(email.to).success) {
    throw new Error(`email: invalid "to" address: ${JSON.stringify(email.to)}`);
  }
  if (/[\r\n]/.test(email.subject)) {
    throw new Error("email: subject must not contain line breaks (header injection)");
  }
  if (email.listUnsubscribeUrl && /[\r\n<>]/.test(email.listUnsubscribeUrl)) {
    throw new Error(
      "email: listUnsubscribeUrl must not contain line breaks or angle brackets (header injection)",
    );
  }
}

/** RFC 8058 one-click unsubscribe header pair for a per-recipient URL. */
function listUnsubscribeHeaders(url: string): { name: string; value: string }[] {
  return [
    { name: "List-Unsubscribe", value: `<${url}>` },
    { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
  ];
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<{ providerMessageId: string }>;
}

/** Default: logs to stdout. A bare self-host works with zero email config. */
export function consoleEmailProvider(): EmailProvider {
  return {
    name: "console",
    async send(email) {
      const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      console.log(
        `[email:console] to=${email.to} subject="${email.subject}" id=${id}\n${email.text}`,
      );
      return { providerMessageId: id };
    },
  };
}

/** Minimal shape of the SESv2 client so tests can inject a mock. */
export interface SesClientLike {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export interface SesEmailConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Verified sender identity, e.g. "notices@yourdomain.com". */
  from: string;
  /** Injectable for tests; defaults to a real SESv2Client. */
  client?: SesClientLike;
}

/** AWS SES (v2 API): SendEmail with Simple content. */
export function sesEmailProvider(cfg: SesEmailConfig): EmailProvider {
  const client: SesClientLike =
    cfg.client ??
    (() => {
      const sdk = new SESv2Client({
        region: cfg.region,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
      return { send: (command: SendEmailCommand) => sdk.send(command) };
    })();

  return {
    name: "ses",
    async send(email) {
      assertSendableEmail(email);
      const out = await client.send(
        new SendEmailCommand({
          FromEmailAddress: cfg.from,
          Destination: { ToAddresses: [email.to] },
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: email.text, Charset: "UTF-8" },
                ...(email.html ? { Html: { Data: email.html, Charset: "UTF-8" } } : {}),
              },
              ...(email.listUnsubscribeUrl
                ? {
                    Headers: listUnsubscribeHeaders(email.listUnsubscribeUrl).map((h) => ({
                      Name: h.name,
                      Value: h.value,
                    })),
                  }
                : {}),
            },
          },
        }),
      );
      return { providerMessageId: out.MessageId ?? "" };
    },
  };
}

/** The subset of a nodemailer message we build — also the fake's contract in tests. */
export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/** Minimal shape of a nodemailer transport so tests can inject a fake (no sockets). */
export interface SmtpTransportLike {
  sendMail(message: SmtpMessage): Promise<{ messageId?: string }>;
}

export interface SmtpEmailConfig {
  host: string;
  port: number;
  /** true = implicit TLS (port 465); false = STARTTLS (port 587). */
  secure: boolean;
  user: string;
  pass: string;
  /** Envelope sender, e.g. "notices@yourdomain.com". */
  from: string;
  /** Injectable for tests; defaults to a real nodemailer SMTP transport. */
  transport?: SmtpTransportLike;
}

/**
 * Generic SMTP via nodemailer — point at any mail server (Fastmail, Postmark
 * SMTP, Migadu, a company relay, …). Unlike the SES Simple-content path, this
 * forwards `email.attachments` as nodemailer attachments.
 */
export function smtpEmailProvider(cfg: SmtpEmailConfig): EmailProvider {
  const transport: SmtpTransportLike =
    cfg.transport ??
    (() => {
      const t = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
      });
      return { sendMail: (message: SmtpMessage) => t.sendMail(message) };
    })();

  return {
    name: "smtp",
    async send(email) {
      assertSendableEmail(email);
      const info = await transport.sendMail({
        from: cfg.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.listUnsubscribeUrl
          ? {
              headers: Object.fromEntries(
                listUnsubscribeHeaders(email.listUnsubscribeUrl).map((h) => [h.name, h.value]),
              ),
            }
          : {}),
        ...(email.attachments && email.attachments.length > 0
          ? {
              attachments: email.attachments.map((a) => ({
                filename: a.filename,
                // nodemailer wants a Buffer/string/stream; normalise the Uint8Array.
                content: Buffer.from(a.content),
                contentType: a.contentType,
              })),
            }
          : {}),
      });
      return { providerMessageId: info.messageId ?? "" };
    },
  };
}

/**
 * Capture provider for tests and the dev outbox endpoint — everything "sent"
 * is inspectable in memory.
 */
export function memoryEmailProvider(): EmailProvider & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    name: "memory",
    sent,
    async send(email) {
      sent.push(email);
      return { providerMessageId: `memory-${sent.length}` };
    },
  };
}
