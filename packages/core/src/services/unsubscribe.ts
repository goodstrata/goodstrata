import { createHmac, timingSafeEqual } from "node:crypto";
import {
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  type NotificationType,
} from "@goodstrata/shared";
import type { ServiceContext } from "../context.js";
import { upsertPreference } from "./notificationPreferences.js";

/**
 * Per-recipient one-click unsubscribe: an HMAC-signed token that identifies
 * (userId, notificationType) so a link in an email footer — or an RFC 8058
 * List-Unsubscribe-Post — can turn that user's EMAIL channel off for that
 * notification type without a session. The token grants exactly one narrow
 * write (email pref → off); it can't read anything, can't widen delivery, and
 * carries no PII beyond the opaque user id.
 */

const ALGO = "sha256";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(secret: string, payload: string): string {
  return b64url(createHmac(ALGO, secret).update(payload).digest());
}

/** Mint the opaque token for one (userId, notificationType) pair. */
export function createUnsubscribeToken(
  secret: string,
  userId: string,
  notificationType: NotificationType,
): string {
  const payload = b64url(Buffer.from(JSON.stringify({ u: userId, t: notificationType }), "utf8"));
  return `${payload}.${sign(secret, payload)}`;
}

export interface UnsubscribeClaims {
  userId: string;
  notificationType: NotificationType;
}

/** Verify a token; returns its claims or null (bad shape, bad sig, unknown type). */
export function verifyUnsubscribeToken(secret: string, token: string): UnsubscribeClaims | null {
  const [payload, sig, ...rest] = token.split(".");
  if (!payload || !sig || rest.length > 0) return null;

  const expected = Buffer.from(sign(secret, payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let claims: { u?: unknown; t?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.u !== "string" || typeof claims.t !== "string") return null;
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(claims.t)) return null;
  return { userId: claims.u, notificationType: claims.t as NotificationType };
}

/** Absolute unsubscribe URL for one recipient (the API mounts /api/unsubscribe). */
export function unsubscribeUrl(
  appUrl: string,
  secret: string,
  userId: string,
  notificationType: NotificationType,
): string {
  const token = createUnsubscribeToken(secret, userId, notificationType);
  return `${appUrl.replace(/\/$/, "")}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export interface ApplyUnsubscribeResult {
  userId: string;
  notificationType: NotificationType;
  /** Human label for the notification type ("Levy notices" …) for the confirmation page. */
  label: string;
}

/**
 * Verify a token and flip that user's EMAIL preference off for the token's
 * notification type. Idempotent (upsert). Returns null when the token doesn't
 * verify — the endpoint answers 400 without touching anything.
 */
export async function applyUnsubscribe(
  ctx: ServiceContext,
  secret: string,
  token: string,
): Promise<ApplyUnsubscribeResult | null> {
  const claims = verifyUnsubscribeToken(secret, token);
  if (!claims) return null;
  await upsertPreference(ctx, claims.userId, {
    notificationType: claims.notificationType,
    channel: "email",
    enabled: false,
  });
  return { ...claims, label: NOTIFICATION_TYPE_META[claims.notificationType].label };
}
