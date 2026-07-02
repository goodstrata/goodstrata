export interface OutboundSms {
  to: string;
  body: string;
}

export interface SmsProvider {
  readonly name: string;
  send(sms: OutboundSms): Promise<{ providerMessageId: string }>;
}

export function consoleSmsProvider(): SmsProvider {
  return {
    name: "console",
    async send(sms) {
      const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      console.log(`[sms:console] to=${sms.to} id=${id}\n${sms.body}`);
      return { providerMessageId: id };
    },
  };
}

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  /** Sending number in E.164 format, e.g. "+61400000000". */
  from: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Twilio Messages API via plain fetch (no SDK): POST form-encoded body with
 * Basic auth to /2010-04-01/Accounts/{sid}/Messages.json.
 */
export function twilioSmsProvider(cfg: TwilioSmsConfig): SmsProvider {
  const fetchFn = cfg.fetchFn ?? fetch;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");

  return {
    name: "twilio",
    async send(sms) {
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: sms.to, From: cfg.from, Body: sms.body }).toString(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`twilio: send failed (${res.status}): ${detail}`);
      }
      const out = (await res.json()) as { sid?: string };
      return { providerMessageId: out.sid ?? "" };
    },
  };
}

export function memorySmsProvider(): SmsProvider & { sent: OutboundSms[] } {
  const sent: OutboundSms[] = [];
  return {
    name: "memory",
    sent,
    async send(sms) {
      sent.push(sms);
      return { providerMessageId: `memory-${sent.length}` };
    },
  };
}
