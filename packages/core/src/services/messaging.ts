import {
  conversationMessages,
  conversationParticipants,
  conversations,
  memberships,
  users,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import type { MembershipRole } from "@goodstrata/shared";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

/**
 * Private messaging (DMs): a scheme member writes privately to the committee
 * (as a group) or to a specific officer/manager; officers can write to any
 * member. Plain member↔member DMs are not allowed — at least one side of every
 * conversation is officer-tier, so the feature stays "contact the people who
 * run the building", not a general chat network.
 *
 * Privacy model: every read/write is scoped by (schemeId + the caller's
 * participant row). A non-participant — even a scheme member, even an officer —
 * gets NOT_FOUND, never FORBIDDEN, so a conversation's existence is never
 * leaked (same 404 pattern as the scheme-membership middleware).
 *
 * Committee-group conversations SNAPSHOT the officer roster at creation:
 * whoever holds office at that moment becomes a participant, permanently.
 * New officers do not see earlier threads (the author addressed the committee
 * of that day, not future ones); departing officers keep the threads they were
 * part of. The tradeoff — a leaver retains access, a joiner can't pick up an
 * open thread — is accepted for v1; the alternative (live-resolved audience)
 * silently widens who can read a private message after the fact.
 *
 * Delivery is POLLING v1: no SSE (the hub broadcasts scheme-wide and would
 * leak private payloads). Recipients also get notified through the notifier
 * ("conversation.message.sent" → in-app + email, preference-gated).
 */

/** Roles that count as "officer tier" for messaging (mirrors the committee fan-out set). */
const OFFICER_ROLES: readonly MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
];

const CONVERSATION_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const startConversationInput = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().min(1).max(5000),
  /** Address the committee as a group, or one specific member by userId. */
  to: z.union([
    z.object({ kind: z.literal("committee") }),
    z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  ]),
});
export type StartConversationInput = z.infer<typeof startConversationInput>;

export const sendMessageInput = z.object({ body: z.string().min(1).max(5000) });
export type SendMessageInput = z.infer<typeof sendMessageInput>;

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ParticipantSummary {
  userId: string;
  name: string;
  image: string | null;
}

export interface ConversationSummary {
  id: string;
  subject: string | null;
  /** Everyone in the thread EXCEPT the caller (the inbox row's "who"). */
  otherParticipants: ParticipantSummary[];
  lastMessage: { body: string; senderUserId: string | null; createdAt: string } | null;
  unreadCount: number;
  createdAt: string;
  lastMessageAt: string;
}

export interface ConversationMessageView {
  id: string;
  conversationId: string;
  body: string;
  /** Null when the sender's account has since been deleted. */
  sender: ParticipantSummary | null;
  createdAt: string;
}

const LAST_MESSAGE_PREVIEW_CHARS = 140;

/** Messaging is keyed to the login membership — reject agent/system actors. */
function requireUserActor(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Private messaging requires a signed-in member", 403);
  }
  return ctx.actor.id;
}

/** Distinct active officer-tier userIds in the scheme (the "committee" audience). */
async function officerUserIds(ctx: ServiceContext, schemeId: string): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.schemeId, schemeId),
        inArray(memberships.role, [...OFFICER_ROLES]),
        isNull(memberships.endedOn),
        isNotNull(memberships.userId),
      ),
    );
  return rows.map((r) => r.userId).filter((id): id is string => id !== null);
}

/** The user's active roles in the scheme (empty = not a member). */
async function activeRoles(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
): Promise<MembershipRole[]> {
  const rows = await ctx.db
    .selectDistinct({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.schemeId, schemeId),
        eq(memberships.userId, userId),
        isNull(memberships.endedOn),
      ),
    );
  return rows.map((r) => r.role);
}

function isOfficer(roles: MembershipRole[]): boolean {
  return roles.some((r) => OFFICER_ROLES.includes(r));
}

/**
 * The caller's participant row + the conversation, or NOT_FOUND. This is the
 * single authorization gate for reads and writes on an existing conversation —
 * scheme-scoped so an id can't be probed across schemes.
 */
async function requireParticipant(
  ctx: ServiceContext,
  schemeId: string,
  conversationId: string,
  userId: string,
) {
  const rows = await ctx.db
    .select({ conversation: conversations, participant: conversationParticipants })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, conversations.id),
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.schemeId, schemeId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Conversation");
  return row;
}

// ---------------------------------------------------------------------------
// Start / send
// ---------------------------------------------------------------------------

/**
 * Start a conversation and send its first message atomically. Audience rules:
 *  - any member → the committee (all current officer-tier users, snapshot)
 *  - any member → a specific officer/manager
 *  - an officer → any member
 * Plain member↔member is rejected; a target who isn't an active member of the
 * scheme reads as NOT_FOUND (their (non-)membership is not leaked).
 */
export async function startConversation(
  ctx: ServiceContext,
  schemeId: string,
  input: StartConversationInput,
): Promise<{ conversation: ConversationSummary; message: ConversationMessageView }> {
  const callerId = requireUserActor(ctx);
  const callerRoles = await activeRoles(ctx, schemeId, callerId);
  if (callerRoles.length === 0) throw notFound("Scheme");

  let recipientIds: string[];
  if (input.to.kind === "committee") {
    const officers = await officerUserIds(ctx, schemeId);
    recipientIds = officers.filter((id) => id !== callerId);
    if (recipientIds.length === 0) {
      throw new DomainError(
        "NO_COMMITTEE",
        "No committee members or manager to message in this scheme",
        422,
      );
    }
  } else {
    const targetId = input.to.userId;
    if (targetId === callerId) {
      throw new DomainError("VALIDATION", "You cannot start a conversation with yourself", 422);
    }
    const targetRoles = await activeRoles(ctx, schemeId, targetId);
    if (targetRoles.length === 0) throw notFound("Member");
    if (!isOfficer(callerRoles) && !isOfficer(targetRoles)) {
      throw new DomainError(
        "FORBIDDEN",
        "Private messages go to the committee or manager — direct member-to-member messages are not available",
        403,
      );
    }
    recipientIds = [targetId];
  }

  const { conversation, message } = await ctx.db.transaction(async (tx) => {
    const conversation = (
      await tx
        .insert(conversations)
        .values({ schemeId, subject: input.subject ?? null, createdBy: callerId })
        .returning()
    )[0]!;

    await tx.insert(conversationParticipants).values(
      [callerId, ...recipientIds].map((userId) => ({
        schemeId,
        conversationId: conversation.id,
        userId,
      })),
    );

    const message = (
      await tx
        .insert(conversationMessages)
        .values({
          schemeId,
          conversationId: conversation.id,
          senderUserId: callerId,
          body: input.body,
        })
        .returning()
    )[0]!;

    // lastMessageAt mirrors the message's own DB timestamp EXACTLY — read
    // watermarks compare against it, so the copy happens inside Postgres: a JS
    // Date round-trip truncates microseconds and would leave lastMessageAt up
    // to 999µs behind the stored created_at (making markRead miss the message).
    await tx
      .update(conversations)
      .set({ lastMessageAt: exactMessageCreatedAt(message.id) })
      .where(eq(conversations.id, conversation.id));

    await publishEvent(tx, {
      schemeId,
      stream: `conversation:${conversation.id}`,
      type: "conversation.message.sent",
      payload: {
        conversationId: conversation.id,
        messageId: message.id,
        senderUserId: callerId,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return { conversation, message };
  });

  const people = await loadParticipantSummaries(ctx, [callerId, ...recipientIds]);
  return {
    conversation: {
      id: conversation.id,
      subject: conversation.subject,
      otherParticipants: recipientIds
        .map((id) => people.get(id))
        .filter((p): p is ParticipantSummary => p !== undefined),
      lastMessage: {
        body: preview(message.body),
        senderUserId: callerId,
        createdAt: message.createdAt.toISOString(),
      },
      unreadCount: 0,
      createdAt: conversation.createdAt.toISOString(),
      lastMessageAt: message.createdAt.toISOString(),
    },
    message: toMessageView(message, people.get(callerId) ?? null),
  };
}

/** Send a message into a conversation the caller participates in. */
export async function sendMessage(
  ctx: ServiceContext,
  schemeId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<{ message: ConversationMessageView }> {
  const senderId = requireUserActor(ctx);
  await requireParticipant(ctx, schemeId, conversationId, senderId);

  const message = await ctx.db.transaction(async (tx) => {
    const message = (
      await tx
        .insert(conversationMessages)
        .values({ schemeId, conversationId, senderUserId: senderId, body: input.body })
        .returning()
    )[0]!;

    // In-DB copy for microsecond exactness — see the note in startConversation.
    await tx
      .update(conversations)
      .set({ lastMessageAt: exactMessageCreatedAt(message.id) })
      .where(eq(conversations.id, conversationId));

    await publishEvent(tx, {
      schemeId,
      stream: `conversation:${conversationId}`,
      type: "conversation.message.sent",
      payload: { conversationId, messageId: message.id, senderUserId: senderId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return message;
  });

  const people = await loadParticipantSummaries(ctx, [senderId]);
  return { message: toMessageView(message, people.get(senderId) ?? null) };
}

// ---------------------------------------------------------------------------
// Inbox / thread reads
// ---------------------------------------------------------------------------

/**
 * Keyset cursor for the inbox: the cursor is the last conversation's id; the
 * comparison anchors on that row's (last_message_at, id) inside Postgres (JS
 * Dates are millisecond-precision, Postgres timestamps microsecond — comparing
 * in JS silently skips same-millisecond rows). Anchor lookup is scheme-scoped
 * so a cursor can't probe conversations in other schemes.
 */
function inboxCursorFilter(schemeId: string, cursor: string | undefined) {
  if (!cursor) return undefined;
  return sql`(${conversations.lastMessageAt}, ${conversations.id}) < (select c.last_message_at, c.id from ${conversations} as c where c.id = ${cursor} and c.scheme_id = ${schemeId})`;
}

/**
 * The caller's inbox: conversations they participate in, most recent activity
 * first, each with the other participants, a preview of the last message, and
 * the unread count derived from their lastReadAt watermark.
 */
export async function listConversations(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
  cursor?: string,
): Promise<{ conversations: ConversationSummary[]; nextCursor?: string }> {
  const rows = await ctx.db
    .select({ conversation: conversations })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
    .where(
      and(
        eq(conversationParticipants.userId, userId),
        eq(conversations.schemeId, schemeId),
        inboxCursorFilter(schemeId, cursor),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(CONVERSATION_PAGE_SIZE + 1);

  const hasMore = rows.length > CONVERSATION_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, CONVERSATION_PAGE_SIZE) : rows;
  if (page.length === 0) return { conversations: [] };

  const ids = page.map((r) => r.conversation.id);
  const [others, lastMessages, unread] = await Promise.all([
    otherParticipantsFor(ctx, ids, userId),
    lastMessagesFor(ctx, ids),
    unreadCountsFor(ctx, ids, userId),
  ]);

  const summaries = page.map(({ conversation: c }) => ({
    id: c.id,
    subject: c.subject,
    otherParticipants: others.get(c.id) ?? [],
    lastMessage: lastMessages.get(c.id) ?? null,
    unreadCount: unread.get(c.id) ?? 0,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
  }));

  return {
    conversations: summaries,
    nextCursor: hasMore ? page[page.length - 1]!.conversation.id : undefined,
  };
}

/** Keyset cursor for a thread — same anchor pattern, scoped to the conversation. */
function messageCursorFilter(conversationId: string, cursor: string | undefined) {
  if (!cursor) return undefined;
  return sql`(${conversationMessages.createdAt}, ${conversationMessages.id}) < (select m.created_at, m.id from ${conversationMessages} as m where m.id = ${cursor} and m.conversation_id = ${conversationId})`;
}

/**
 * Messages in a conversation, newest first (clients render bottom-up),
 * keyset-paginated on (createdAt, id). Participant-only; soft-deleted messages
 * are filtered out.
 */
export async function listMessages(
  ctx: ServiceContext,
  schemeId: string,
  conversationId: string,
  userId: string,
  cursor?: string,
): Promise<{ messages: ConversationMessageView[]; nextCursor?: string }> {
  await requireParticipant(ctx, schemeId, conversationId, userId);

  const rows = await ctx.db
    .select({
      id: conversationMessages.id,
      body: conversationMessages.body,
      createdAt: conversationMessages.createdAt,
      senderUserId: conversationMessages.senderUserId,
      senderName: users.name,
      senderImage: users.image,
    })
    .from(conversationMessages)
    .leftJoin(users, eq(conversationMessages.senderUserId, users.id))
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        messageCursorFilter(conversationId, cursor),
      ),
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(MESSAGE_PAGE_SIZE + 1);

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows;

  const messages = page.map((m) => ({
    id: m.id,
    conversationId,
    body: m.body,
    sender:
      m.senderUserId && m.senderName !== null
        ? { userId: m.senderUserId, name: m.senderName, image: m.senderImage }
        : null,
    createdAt: m.createdAt.toISOString(),
  }));

  return { messages, nextCursor: hasMore ? page[page.length - 1]!.id : undefined };
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

/**
 * Mark the conversation read for the caller: the watermark becomes the
 * conversation's lastMessageAt (the same DB clock that stamps messages), so
 * "read" is exact — no cross-clock comparisons, no same-millisecond drift.
 */
export async function markRead(
  ctx: ServiceContext,
  schemeId: string,
  conversationId: string,
  userId: string,
): Promise<{ conversationId: string; lastReadAt: string }> {
  const { conversation, participant } = await requireParticipant(
    ctx,
    schemeId,
    conversationId,
    userId,
  );

  // In-DB copy: lastMessageAt carries microseconds; assigning the JS Date
  // (millisecond precision) would set the watermark just BEFORE the newest
  // message and leave it forever unread.
  await ctx.db
    .update(conversationParticipants)
    .set({
      lastReadAt: sql`(select c.last_message_at from ${conversations} as c where c.id = ${conversationId})`,
    })
    .where(eq(conversationParticipants.id, participant.id));

  return { conversationId, lastReadAt: conversation.lastMessageAt.toISOString() };
}

/**
 * Total unread messages for the caller across the scheme — one cheap COUNT for
 * the nav badge (polled).
 */
export async function totalUnread(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
): Promise<{ unread: number }> {
  const rows = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationMessages)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, conversationMessages.conversationId),
    )
    .where(
      and(
        eq(conversationParticipants.userId, userId),
        eq(conversationParticipants.schemeId, schemeId),
        isNull(conversationMessages.deletedAt),
        unreadMessageFilter(userId),
      ),
    );
  return { unread: rows[0]?.count ?? 0 };
}

// ---------------------------------------------------------------------------
// Enrichment helpers
// ---------------------------------------------------------------------------

/** The stored (microsecond-precise) created_at of one message, for in-DB copies. */
function exactMessageCreatedAt(messageId: string) {
  return sql`(select m.created_at from ${conversationMessages} as m where m.id = ${messageId})`;
}

/** Unread = someone else's message, newer than my watermark (or any, when unset). */
function unreadMessageFilter(userId: string) {
  return and(
    or(isNull(conversationMessages.senderUserId), ne(conversationMessages.senderUserId, userId)),
    or(
      isNull(conversationParticipants.lastReadAt),
      sql`${conversationMessages.createdAt} > ${conversationParticipants.lastReadAt}`,
    ),
  );
}

async function loadParticipantSummaries(
  ctx: ServiceContext,
  userIds: string[],
): Promise<Map<string, ParticipantSummary>> {
  const map = new Map<string, ParticipantSummary>();
  if (userIds.length === 0) return map;
  const rows = await ctx.db.query.users.findMany({
    where: inArray(users.id, [...new Set(userIds)]),
    columns: { id: true, name: true, image: true },
  });
  for (const u of rows) map.set(u.id, { userId: u.id, name: u.name, image: u.image });
  return map;
}

async function otherParticipantsFor(
  ctx: ServiceContext,
  conversationIds: string[],
  userId: string,
): Promise<Map<string, ParticipantSummary[]>> {
  const map = new Map<string, ParticipantSummary[]>();
  if (conversationIds.length === 0) return map;
  const rows = await ctx.db
    .select({
      conversationId: conversationParticipants.conversationId,
      userId: conversationParticipants.userId,
      name: users.name,
      image: users.image,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(conversationParticipants.userId, users.id))
    .where(
      and(
        inArray(conversationParticipants.conversationId, conversationIds),
        ne(conversationParticipants.userId, userId),
      ),
    )
    .orderBy(conversationParticipants.joinedAt);
  for (const r of rows) {
    const list = map.get(r.conversationId) ?? [];
    list.push({ userId: r.userId, name: r.name, image: r.image });
    map.set(r.conversationId, list);
  }
  return map;
}

async function lastMessagesFor(
  ctx: ServiceContext,
  conversationIds: string[],
): Promise<Map<string, ConversationSummary["lastMessage"]>> {
  const map = new Map<string, ConversationSummary["lastMessage"]>();
  if (conversationIds.length === 0) return map;
  const rows = await ctx.db
    .selectDistinctOn([conversationMessages.conversationId], {
      conversationId: conversationMessages.conversationId,
      body: conversationMessages.body,
      senderUserId: conversationMessages.senderUserId,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        inArray(conversationMessages.conversationId, conversationIds),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .orderBy(
      conversationMessages.conversationId,
      desc(conversationMessages.createdAt),
      desc(conversationMessages.id),
    );
  for (const r of rows) {
    map.set(r.conversationId, {
      body: preview(r.body),
      senderUserId: r.senderUserId,
      createdAt: r.createdAt.toISOString(),
    });
  }
  return map;
}

async function unreadCountsFor(
  ctx: ServiceContext,
  conversationIds: string[],
  userId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (conversationIds.length === 0) return map;
  const rows = await ctx.db
    .select({
      conversationId: conversationMessages.conversationId,
      count: sql<number>`count(*)::int`,
    })
    .from(conversationMessages)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, conversationMessages.conversationId),
    )
    .where(
      and(
        inArray(conversationMessages.conversationId, conversationIds),
        eq(conversationParticipants.userId, userId),
        isNull(conversationMessages.deletedAt),
        unreadMessageFilter(userId),
      ),
    )
    .groupBy(conversationMessages.conversationId);
  for (const r of rows) map.set(r.conversationId, r.count);
  return map;
}

function preview(body: string): string {
  return body.length > LAST_MESSAGE_PREVIEW_CHARS
    ? `${body.slice(0, LAST_MESSAGE_PREVIEW_CHARS - 1)}…`
    : body;
}

function toMessageView(
  message: typeof conversationMessages.$inferSelect,
  sender: ParticipantSummary | null,
): ConversationMessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    body: message.body,
    sender,
    createdAt: message.createdAt.toISOString(),
  };
}
