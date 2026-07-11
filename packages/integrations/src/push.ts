/**
 * Push notifications to the member app's devices via the Expo Push HTTP API.
 * Same provider pattern as email/sms: console (default, zero-config), expo
 * (the real thing, plain fetch — no SDK), and memory (test capture).
 *
 * Unlike email/sms, `send` takes a BATCH: Expo accepts up to 100 messages per
 * request, and one notifier delivery fans out to every device of every
 * recipient. Per-recipient and request failures are returned with partial
 * progress so callers can persist accepted tickets and retry only unsent
 * targets without discarding successful earlier chunks.
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
  /**
   * Successful Expo tickets to persist until their asynchronous receipts are
   * ready. Empty for providers that do not expose a receipt lifecycle.
   */
  receiptTickets: PushReceiptTicket[];
  /** Tokens with a terminal send ticket (accepted or non-retryable error). */
  processedTokens: string[];
  /** Tokens not sent because their ticket/request failed retryably. */
  retryTokens: string[];
  /** Transport/request detail when a batch stopped before all chunks sent. */
  error?: string;
}

/** The durable mapping needed to turn an Expo receipt back into a device. */
export interface PushReceiptTicket {
  receiptId: string;
  token: string;
}

export interface PushReceiptOutcome {
  /** Tokens whose available receipt reports DeviceNotRegistered. */
  invalidTokens: string[];
  /** Receipt ids that Expo returned (success or terminal error). */
  processedReceiptIds: string[];
}

export interface PushProvider {
  readonly name: string;
  send(messages: OutboundPush[]): Promise<PushSendOutcome>;
  /** Optional because console/memory providers have no asynchronous receipts. */
  checkReceipts?(tickets: PushReceiptTicket[]): Promise<PushReceiptOutcome>;
}

/** Default: logs to stdout. A bare self-host works with zero push config. */
export function consolePushProvider(): PushProvider {
  return {
    name: "console",
    async send(messages) {
      for (const m of messages) {
        console.log(`[push:console] to=${m.to} title="${m.title}"\n${m.body}`);
      }
      return {
        invalidTokens: [],
        receiptTickets: [],
        processedTokens: messages.map((message) => message.to),
        retryTokens: [],
      };
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
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo rejects requests with more than 100 messages (PUSH_TOO_MANY_NOTIFICATIONS). */
const EXPO_PUSH_CHUNK = 100;
/** Conservative receipt batch size (kept below Expo's endpoint limit). */
const EXPO_RECEIPT_CHUNK = 300;

/** One per-message ticket in the response; tickets answer in request order. */
interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

function expoHeaders(accessToken?: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function assertExpoResponse(res: Response, operation: "send" | "receipts"): Promise<void> {
  if (res.ok) return;
  const detail = await res.text().catch(() => "");
  throw new Error(`expo-push: ${operation} failed (${res.status}): ${detail}`);
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
      const receiptTickets: PushReceiptTicket[] = [];
      const processedTokens: string[] = [];
      const retryTokens: string[] = [];
      let error: string | undefined;
      for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK) {
        const chunk = messages.slice(i, i + EXPO_PUSH_CHUNK);
        try {
          const res = await fetchFn(EXPO_PUSH_URL, {
            method: "POST",
            headers: expoHeaders(cfg.accessToken),
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
          await assertExpoResponse(res, "send");
          const out = (await res.json()) as { data?: ExpoPushTicket[] };
          // Ticket j answers chunk[j] — each message here targets one token.
          chunk.forEach((message, j) => {
            const ticket = out.data?.[j];
            if (!ticket) {
              retryTokens.push(message.to);
              return;
            }
            processedTokens.push(message.to);
            if (ticket.status === "ok") {
              if (ticket.id) receiptTickets.push({ receiptId: ticket.id, token: message.to });
              return;
            }
            if (ticket.details?.error === "DeviceNotRegistered") {
              invalidTokens.push(message.to);
            } else {
              console.error(
                `[push:expo] ticket error for ${message.to}: ${
                  ticket.details?.error ?? ticket.message ?? "unknown"
                }`,
              );
            }
          });
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          // Stop on a request failure (often rate limiting) and explicitly
          // return the failed chunk plus every untouched later chunk.
          retryTokens.push(...messages.slice(i).map((message) => message.to));
          break;
        }
      }
      return {
        invalidTokens: [...new Set(invalidTokens)],
        receiptTickets,
        processedTokens: [...new Set(processedTokens)],
        retryTokens: [...new Set(retryTokens)],
        ...(error ? { error } : {}),
      };
    },
    async checkReceipts(tickets) {
      const invalidTokens: string[] = [];
      const processedReceiptIds: string[] = [];
      const uniqueTickets = [
        ...new Map(tickets.map((ticket) => [ticket.receiptId, ticket])).values(),
      ];

      for (let i = 0; i < uniqueTickets.length; i += EXPO_RECEIPT_CHUNK) {
        const chunk = uniqueTickets.slice(i, i + EXPO_RECEIPT_CHUNK);
        const res = await fetchFn(EXPO_RECEIPTS_URL, {
          method: "POST",
          headers: expoHeaders(cfg.accessToken),
          body: JSON.stringify({ ids: chunk.map((ticket) => ticket.receiptId) }),
        });
        await assertExpoResponse(res, "receipts");
        const out = (await res.json()) as {
          data?: Record<string, ExpoPushReceipt>;
          errors?: Array<{ code?: string; message?: string }>;
        };
        if (out.errors?.length) {
          throw new Error(
            `expo-push: receipts failed: ${out.errors
              .map((error) => error.code ?? error.message ?? "unknown")
              .join(", ")}`,
          );
        }

        for (const ticket of chunk) {
          // Expo omits ids whose receipts are not ready yet. Leave those in
          // the durable queue so a later sweep can retry them.
          const receipt = out.data?.[ticket.receiptId];
          if (!receipt) continue;
          processedReceiptIds.push(ticket.receiptId);
          if (receipt.status !== "error") continue;
          if (receipt.details?.error === "DeviceNotRegistered") {
            invalidTokens.push(ticket.token);
          } else {
            console.error(
              `[push:expo] receipt error for ${ticket.token}: ${
                receipt.details?.error ?? receipt.message ?? "unknown"
              }`,
            );
          }
        }
      }

      return {
        invalidTokens: [...new Set(invalidTokens)],
        processedReceiptIds,
      };
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
      return {
        invalidTokens: messages.map((m) => m.to).filter((t) => deadTokens.has(t)),
        receiptTickets: [],
        processedTokens: messages.map((message) => message.to),
        retryTokens: [],
      };
    },
  };
}
