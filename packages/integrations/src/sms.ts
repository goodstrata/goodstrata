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
