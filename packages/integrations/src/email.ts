import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body (always present — accessibility + archival). */
  text: string;
  html?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
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
            },
          },
        }),
      );
      return { providerMessageId: out.MessageId ?? "" };
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
