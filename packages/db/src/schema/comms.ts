import { MESSAGE_CHANNELS, MESSAGE_STATUSES } from "@goodstrata/shared";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { people, schemes } from "./tenancy.js";

export const messageChannelEnum = pgEnum("message_channel", MESSAGE_CHANNELS);
export const messageStatusEnum = pgEnum("message_status", MESSAGE_STATUSES);
export const messageDirectionEnum = pgEnum("message_direction", ["outbound", "inbound"]);

/** Every email/SMS/in-app message, in or out — the correspondence log. */
export const messages = pgTable(
  "messages",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    channel: messageChannelEnum().notNull(),
    direction: messageDirectionEnum().notNull().default("outbound"),
    personId: uuid().references(() => people.id),
    toAddress: text().notNull(),
    subject: text(),
    body: text().notNull(),
    template: text(),
    status: messageStatusEnum().notNull().default("queued"),
    providerMessageId: text(),
    /** What this message is about: { type: "levy_notice", id } etc. */
    related: jsonb(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("messages_scheme_idx").on(t.schemeId, t.createdAt)],
);

export const announcements = pgTable(
  "announcements",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    title: text().notNull(),
    body: text().notNull(),
    audience: text().notNull().default("all"), // all | owners | committee
    publishedAt: timestamp({ withTimezone: true }),
    createdBy: jsonb().notNull(), // Actor
    createdAt: createdAt(),
  },
  (t) => [index("announcements_scheme_idx").on(t.schemeId)],
);
