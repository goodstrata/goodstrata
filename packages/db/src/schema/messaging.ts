import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { users } from "./auth.js";
import { schemes } from "./tenancy.js";

/**
 * Private messaging (DMs): owners/tenants message the committee or the manager
 * privately. Distinct from `messages` in comms.ts — that table is the outbound
 * correspondence log (levy notices, meeting notices); these are two-way private
 * threads between login identities.
 *
 * Participation is a SNAPSHOT taken when the conversation starts: a
 * member who writes to "the committee" is writing to the people who hold
 * office at that moment. New officers do not gain access to earlier private
 * threads, and a departing officer keeps the threads they were part of —
 * widening the audience retroactively would leak messages the author never
 * addressed to those people.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    /** Optional topic line ("Query about levy notice"), shown in the inbox list. */
    subject: text(),
    /** ON DELETE SET NULL: the thread survives account deletion; only the starter link severs. */
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** Bumped on every send — the inbox sort key. */
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_scheme_last_message_idx").on(t.schemeId, t.lastMessageAt)],
);

/**
 * Who can see a conversation. Membership here is the ONLY read/write grant —
 * every query joins through this table, so a non-participant can never learn
 * a conversation exists (404 pattern).
 */
export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    /** CASCADE: a participant row without a login is meaningless (thread + messages survive). */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Read watermark: messages with createdAt > lastReadAt (or all, when null)
     * from OTHER senders count as unread. markRead sets it to the
     * conversation's lastMessageAt so read state never mixes clock sources.
     */
    lastReadAt: timestamp({ withTimezone: true }),
    joinedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversation_participants_conversation_user_idx").on(t.conversationId, t.userId),
    /** Hot path: a user's inbox (participant → conversations, sorted by lastMessageAt). */
    index("conversation_participants_user_idx").on(t.userId, t.schemeId),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    /** ON DELETE SET NULL: the message survives account deletion; only the sender link severs. */
    senderUserId: text().references(() => users.id, { onDelete: "set null" }),
    body: text().notNull(),
    createdAt: createdAt(),
    /** Soft delete tombstone — reads filter it; the row stays for the record. */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    /** Hot path: a conversation's messages by time (keyset pagination). */
    index("conversation_messages_conversation_created_idx").on(t.conversationId, t.createdAt),
  ],
);
