import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { users } from "./auth.js";
import { schemes } from "./tenancy.js";

/**
 * In-app notifications, one row per recipient user. Written by the notifier
 * (a pure-code event consumer) and by services that address users directly.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    /** ON DELETE SET NULL: keeps the notification row on the spine; the recipient link severs. */
    userId: text().references(() => users.id, { onDelete: "set null" }),
    title: text().notNull(),
    body: text().notNull(),
    /** finance | maintenance | meeting | decision | general */
    category: text().notNull(),
    /** What this notification is about: { type: "decision", id }. */
    related: jsonb().$type<{ type: string; id: string } | null>(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)],
);
