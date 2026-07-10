/**
 * Push notifications to the member app's devices via the Expo Push HTTP API.
 * Same provider pattern as email/sms: console (default, zero-config), expo
 * (the real thing, plain fetch — no SDK), and memory (test capture).
 *
 * Unlike email/sms, `send` takes a BATCH: Expo accepts up to 100 messages per
 * request, and one notifier delivery fans out to every device of every
 * recipient. Per-recipient failures never throw — the one callers must act on
 * (DeviceNotRegistered → prune the token) is surfaced in the result; only a
 * transport/request-level failure throws.
 */

export interface OutboundPush {
  /** Expo push token of ONE device (e.g. "ExponentPushToken[…]"). */
  to: string;
  title: string;
  body: string;
  /** JSON payload delivered alongside (the deep-link anchor: scheme/related). */
  data?: Record<string, unknown>;
}

export interface PushSendOutcome {
  /**
   * Tokens the provider reported as DeviceNotRegistered — the app was
   * uninstalled or its token rotated. Callers should prune these and never
   * retry them.
   */
  invalidTokens: string[];
}

export interface PushProvider {
  readonly name: string;
  send(messages: OutboundPush[]): Promise<PushSendOutcome>;
}

/** Default: logs to stdout. A bare self-host works with zero push config. */
export function consolePushProvider(): PushProvider {
  return {
    name: "console",
    async send(messages) {
      for (const m of messages) {
        console.log(`[push:console] to=${m.to} title="${m.title}"\n${m.body}`);
      }
      return { invalidTokens: [] };
    },
  };
}

export interface ExpoPushConfig {
  /** Optional bearer for Expo's enhanced push security (EXPO_ACCESS_TOKEN). */
  accessToken?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo rejects requests with more than 100 messages (PUSH_TOO_MANY_NOTIFICATIONS). */
const EXPO_PUSH_CHUNK = 100;

/** One per-message ticket in the response; tickets answer in request order. */
interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Expo Push HTTP API via plain fetch (no SDK): POST JSON arrays of ≤100
 * messages, parse the per-message tickets, and surface DeviceNotRegistered
 * tokens so callers can prune them. Other ticket errors only log — the bell
 * row already exists, and there is nothing actionable per recipient.
 */
export function expoPushProvider(cfg: ExpoPushConfig = {}): PushProvider {
  const fetchFn = cfg.fetchFn ?? fetch;
  return {
    name: "expo",
    async send(messages) {
      const invalidTokens: string[] = [];
      for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK) {
        const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK);
        const res = await fetchFn(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(cfg.accessToken ? { authorization: `Bearer ${cfg.accessToken}` } : {}),
          },
          body: JSON.stringify(
            chunk.map((m) => ({
              to: m.to,
              title: m.title,
              body: m.body,
              sound: "default",
              // The channel the app creates before minting a token (Android 8+).
              channelId: "default",
              ...(m.data ? { data: m.data } : {}),
            })),
          ),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`expo-push: send failed (${res.status}): ${detail}`);
        }
        const out = (await res.json()) as { data?: ExpoPushTicket[] };
        // Ticket j answers chunk[j] — each message here targets one token.
        (out.data ?? []).forEach((ticket, j) => {
          if (ticket.status !== "error") return;
          const token = chunk[j]?.to;
          if (ticket.details?.error === "DeviceNotRegistered") {
            if (token) invalidTokens.push(token);
          } else {
            console.error(
              `[push:expo] ticket error for ${token}: ${
                ticket.details?.error ?? ticket.message ?? "unknown"
              }`,
            );
          }
        });
      }
      return { invalidTokens };
    },
  };
}

/**
 * Capture provider for tests — everything "sent" is inspectable in memory.
 * Add a token to `deadTokens` to have the fake report it DeviceNotRegistered
 * (exercises the caller's pruning path).
 */
export function memoryPushProvider(): PushProvider & {
  sent: OutboundPush[];
  deadTokens: Set<string>;
} {
  const sent: OutboundPush[] = [];
  const deadTokens = new Set<string>();
  return {
    name: "memory",
    sent,
    deadTokens,
    async send(messages) {
      sent.push(...messages);
      return { invalidTokens: messages.map((m) => m.to).filter((t) => deadTokens.has(t)) };
    },
  };
}
