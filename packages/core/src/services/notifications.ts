import { notifications } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { and, eq, isNull } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { notFound } from "../errors.js";

export const NOTIFICATION_CATEGORIES = [
  "finance",
  "maintenance",
  "meeting",
  "decision",
  "general",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface CreateNotificationInput {
  schemeId: string;
  userId: string;
  title: string;
  body: string;
  category: NotificationCategory;
  related?: { type: string; id: string };
}

/** Insert an in-app notification + notification.created in one transaction. */
export async function createNotification(ctx: ServiceContext, input: CreateNotificationInput) {
  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(notifications)
      .values({
        schemeId: input.schemeId,
        userId: input.userId,
        title: input.title,
        body: input.body,
        category: input.category,
        related: input.related ?? null,
      })
      .returning();
    const notification = rows[0]!;

    await publishEvent(tx, {
      schemeId: input.schemeId,
      stream: `notification:${notification.id}`,
      type: "notification.created",
      payload: {
        notificationId: notification.id,
        userId: notification.userId,
        title: notification.title,
        category: notification.category,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return notification;
  });
}

/** Fan the same notification out to a set of users (deduped). */
export async function notifyUsers(
  ctx: ServiceContext,
  schemeId: string,
  userIds: string[],
  input: Omit<CreateNotificationInput, "schemeId" | "userId">,
) {
  const created = [];
  for (const userId of [...new Set(userIds)]) {
    created.push(await createNotification(ctx, { ...input, schemeId, userId }));
  }
  return created;
}

export async function listNotifications(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
  opts?: { unreadOnly?: boolean },
) {
  return await ctx.db.query.notifications.findMany({
    where: and(
      eq(notifications.schemeId, schemeId),
      eq(notifications.userId, userId),
      opts?.unreadOnly ? isNull(notifications.readAt) : undefined,
    ),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

/** Mark one notification (or all unread) as read for the user. */
export async function markRead(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
  notificationId: string | "all",
) {
  const now = ctx.clock.now();

  if (notificationId === "all") {
    const rows = await ctx.db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.schemeId, schemeId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }

  const rows = await ctx.db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.schemeId, schemeId),
        eq(notifications.userId, userId),
      ),
    )
    .returning({ id: notifications.id });
  if (rows.length === 0) throw notFound("Notification");
  return { updated: rows.length };
}
