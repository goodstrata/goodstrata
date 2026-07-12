import { notificationPreferences, people, pushTokens, users } from "@goodstrata/db";
import {
  effectiveNotificationChannel,
  NOTIFICATION_PREF_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationPrefChannel,
  type NotificationType,
} from "@goodstrata/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { ServiceContext } from "../context.js";

/**
 * Per-user notification preferences: the resolver the notifier consults at
 * send time, plus the list/upsert helpers the profile API uses.
 *
 * Design: the pref table is sparse (a row only where the user diverged from the
 * default), so every lookup falls back to NOTIFICATION_DEFAULTS. A missing row
 * never silences a notification — the fallback re-asserts the current default,
 * and in_app falls back to on even for an unknown/new type.
 */

/** Candidate recipients split into the channels each is actually eligible for. */
export interface ResolvedRecipients {
  /** userIds to write in-app bell rows for. */
  inApp: string[];
  /** users to email, with a resolved address. */
  email: Array<{ userId: string; email: string }>;
  /** users to SMS, with a resolved phone (pref on AND a number on file). */
  sms: Array<{ userId: string; phone: string }>;
  /**
   * Devices to push to — one entry per registered token (pref on AND at least
   * one token on file), so a user with two devices appears twice.
   */
  push: Array<{ userId: string; token: string }>;
}

/**
 * Build a per-user override map for one notification type: `userId -> { channel
 * -> enabled }` from the sparse pref rows.
 */
async function loadOverrides(
  ctx: ServiceContext,
  userIds: string[],
  notificationType: string,
): Promise<Map<string, Partial<Record<NotificationPrefChannel, boolean>>>> {
  const rows = await ctx.db.query.notificationPreferences.findMany({
    where: and(
      inArray(notificationPreferences.userId, userIds),
      eq(notificationPreferences.notificationType, notificationType),
    ),
  });
  const map = new Map<string, Partial<Record<NotificationPrefChannel, boolean>>>();
  for (const row of rows) {
    const channel = row.channel as NotificationPrefChannel;
    if (!NOTIFICATION_PREF_CHANNELS.includes(channel)) continue;
    const entry = map.get(row.userId) ?? {};
    entry[channel] = row.enabled;
    map.set(row.userId, entry);
  }
  return map;
}

/**
 * Resolve a "phone on file" for each user: prefer the user-level `users.phone`,
 * else fall back to any linked `people.phone` (cross-scheme — prefs are
 * per-user, so we accept a roll number from any scheme the user appears in).
 */
async function resolvePhones(ctx: ServiceContext, userIds: string[]): Promise<Map<string, string>> {
  const phones = new Map<string, string>();
  if (userIds.length === 0) return phones;

  const userRows = await ctx.db.query.users.findMany({
    where: inArray(users.id, userIds),
    columns: { id: true, phone: true },
  });
  for (const u of userRows) {
    if (u.phone) phones.set(u.id, u.phone);
  }

  const missing = userIds.filter((id) => !phones.has(id));
  if (missing.length > 0) {
    const personRows = await ctx.db.query.people.findMany({
      where: and(inArray(people.userId, missing), isNotNull(people.phone)),
      columns: { userId: true, phone: true },
    });
    for (const p of personRows) {
      if (p.userId && p.phone && !phones.has(p.userId)) phones.set(p.userId, p.phone);
    }
  }
  return phones;
}

/**
 * Narrow an already-authorized set of candidate userIds down to the channels
 * each has opted into (defaults applied), resolving email/phone as needed. This
 * only ever NARROWS the recipient set — the caller has already run the
 * role/audience query; the resolver never widens it.
 */
export async function resolveRecipientChannels(
  ctx: ServiceContext,
  userIds: string[],
  notificationType: string,
): Promise<ResolvedRecipients> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return { inApp: [], email: [], sms: [], push: [] };

  const overrides = await loadOverrides(ctx, unique, notificationType);
  const wants = (userId: string, channel: NotificationPrefChannel) =>
    effectiveNotificationChannel(notificationType, channel, overrides.get(userId)?.[channel]);

  const inApp = unique.filter((id) => wants(id, "in_app"));

  // Email: resolve addresses only for those who want email.
  const emailWanted = unique.filter((id) => wants(id, "email"));
  const email: ResolvedRecipients["email"] = [];
  if (emailWanted.length > 0) {
    const userRows = await ctx.db.query.users.findMany({
      where: inArray(users.id, emailWanted),
      columns: { id: true, email: true },
    });
    for (const u of userRows) {
      if (u.email) email.push({ userId: u.id, email: u.email });
    }
  }

  // SMS: only for those who want SMS AND have a phone on file.
  const smsWanted = unique.filter((id) => wants(id, "sms"));
  const phones = await resolvePhones(ctx, smsWanted);
  const sms: ResolvedRecipients["sms"] = smsWanted
    .filter((id) => phones.has(id))
    .map((id) => ({ userId: id, phone: phones.get(id)! }));

  // Push: only for those who want push AND registered at least one device —
  // the token-on-file gate, exactly parallel to SMS's phone-on-file gate.
  const pushWanted = unique.filter((id) => wants(id, "push"));
  const push: ResolvedRecipients["push"] = [];
  if (pushWanted.length > 0) {
    const tokenRows = await ctx.db.query.pushTokens.findMany({
      where: inArray(pushTokens.userId, pushWanted),
      columns: { userId: true, token: true },
    });
    for (const row of tokenRows) push.push({ userId: row.userId, token: row.token });
  }

  return { inApp, email, sms, push };
}

/** The effective (pref ⋁ default) matrix for one user across every type/channel. */
export type EffectivePreferenceMatrix = Record<
  NotificationType,
  Record<NotificationPrefChannel, boolean>
>;

/**
 * Full effective matrix for a user — every type × channel, pref rows merged
 * over defaults. Powers the settings GET (the API groups/labels it via the
 * shared registry).
 */
export async function listEffectivePreferences(
  ctx: ServiceContext,
  userId: string,
): Promise<EffectivePreferenceMatrix> {
  const rows = await ctx.db.query.notificationPreferences.findMany({
    where: eq(notificationPreferences.userId, userId),
  });
  const overrides = new Map<string, Partial<Record<NotificationPrefChannel, boolean>>>();
  for (const row of rows) {
    const channel = row.channel as NotificationPrefChannel;
    if (!NOTIFICATION_PREF_CHANNELS.includes(channel)) continue;
    const entry = overrides.get(row.notificationType) ?? {};
    entry[channel] = row.enabled;
    overrides.set(row.notificationType, entry);
  }

  const matrix = {} as EffectivePreferenceMatrix;
  for (const type of NOTIFICATION_TYPES) {
    const channels = {} as Record<NotificationPrefChannel, boolean>;
    for (const channel of NOTIFICATION_PREF_CHANNELS) {
      channels[channel] = effectiveNotificationChannel(
        type,
        channel,
        overrides.get(type)?.[channel],
      );
    }
    matrix[type] = channels;
  }
  return matrix;
}

export interface UpsertPreferenceInput {
  notificationType: NotificationType;
  channel: NotificationPrefChannel;
  enabled: boolean;
}

/**
 * Upsert one preference row on (userId, type, channel). `userId` is always the
 * caller's session id — never trusted from a request body. Storing `sms=on`
 * with no phone is allowed; send-time gating (phone on file) is the real guard,
 * so the choice is honoured the moment a number is added.
 */
export async function upsertPreference(
  ctx: ServiceContext,
  userId: string,
  input: UpsertPreferenceInput,
) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .insert(notificationPreferences)
    .values({
      userId,
      notificationType: input.notificationType,
      channel: input.channel,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.notificationType,
        notificationPreferences.channel,
      ],
      set: { enabled: input.enabled, updatedAt: now },
    })
    .returning();
  return rows[0]!;
}

/**
 * Whether a user has a phone we could text (users.phone, else any linked
 * people.phone), plus the resolved number — drives the settings "no phone"
 * hint and the SMS column enable/disable.
 */
export async function resolveUserPhone(
  ctx: ServiceContext,
  userId: string,
): Promise<{ phone: string | null; hasPhone: boolean }> {
  const phones = await resolvePhones(ctx, [userId]);
  const phone = phones.get(userId) ?? null;
  return { phone, hasPhone: phone !== null };
}

export interface RegisterPushTokenInput {
  /** The device's Expo push token — the natural key. */
  token: string;
  platform: "ios" | "android";
  deviceName?: string | null;
}

/**
 * Register (or refresh) one device's push token for the session user. Upserts
 * on the TOKEN, not the user: a shared device that signs into a different
 * account re-points the row, so the previous account stops receiving pushes on
 * that device immediately. `userId` is always the caller's session id.
 */
export async function registerPushToken(
  ctx: ServiceContext,
  userId: string,
  input: RegisterPushTokenInput,
) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .insert(pushTokens)
    .values({
      userId,
      token: input.token,
      platform: input.platform,
      deviceName: input.deviceName ?? null,
    })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: {
        userId,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
        lastSeenAt: now,
      },
    })
    .returning();
  return rows[0]!;
}

/**
 * Forget one device token (the sign-out path). Scoped to the session user so
 * nobody can delete another account's registration; removing an unknown token
 * is a no-op ({ removed: 0 }), which keeps sign-out idempotent.
 */
export async function removePushToken(
  ctx: ServiceContext,
  userId: string,
  token: string,
): Promise<{ removed: number }> {
  const rows = await ctx.db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)))
    .returning({ id: pushTokens.id });
  return { removed: rows.length };
}
