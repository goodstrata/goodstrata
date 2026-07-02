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
