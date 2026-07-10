import { conversationMessages, memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, agentActor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as messaging from "../src/services/messaging.js";
import * as notificationsService from "../src/services/notifications.js";
import * as notifierService from "../src/services/notifier.js";

let tdb: TestDatabase;
let schemeId: string;
let otherSchemeId: string;

const CHAIR = "user-chair-m";
const SECRETARY = "user-secretary-m";
const OWNER1 = "user-owner1-m";
const OWNER2 = "user-owner2-m";
const TENANT = "user-tenant-m";
const OUTSIDER = "user-outsider-m";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

function ctx(actor: Actor = userActor(OWNER1)): ServiceContext {
  return { db: tdb.db, clock: fixedClock("2026-07-05T00:00:00Z"), integrations, actor };
}

async function newScheme(name: string, plan: string): Promise<string> {
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name,
      planOfSubdivision: plan,
      addressLine1: "7 Thread St",
      suburb: "Northcote",
      postcode: "3070",
      tier: 3,
      status: "active",
    })
    .returning();
  return rows[0]!.id;
}

/** The latest conversation.message.sent event for a conversation, as the worker would see it. */
async function latestMessageEvent(conversationId: string): Promise<EventRecord> {
  const rows = await tdb.db.query.eventLog.findMany({
    where: (t, { and, eq }) =>
      and(eq(t.type, "conversation.message.sent"), eq(t.stream, `conversation:${conversationId}`)),
    orderBy: (t, { desc }) => desc(t.seq),
    limit: 1,
  });
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as EventRecord;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  schemeId = await newScheme("Messaging Test OC", "PS777001M");
  otherSchemeId = await newScheme("Messaging Other OC", "PS777002M");

  await tdb.db.insert(users).values(
    [CHAIR, SECRETARY, OWNER1, OWNER2, TENANT, OUTSIDER].map((id) => ({
      id,
      name: `Name ${id}`,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: SECRETARY, role: "secretary", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER1, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER2, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: TENANT, role: "tenant", startedOn: "2025-01-01" },
    // OUTSIDER belongs to the other scheme only.
    { schemeId: otherSchemeId, userId: OUTSIDER, role: "owner", startedOn: "2025-01-01" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("startConversation — audiences and the officer rule", () => {
  it("member → committee snapshots every current officer as a participant", async () => {
    const { conversation, message } = await messaging.startConversation(ctx(), schemeId, {
      subject: "Query about my levy notice",
      body: "Hi, I think my levy notice is doubled up?",
      to: { kind: "committee" },
    });

    expect(conversation.subject).toBe("Query about my levy notice");
    expect(conversation.otherParticipants.map((p) => p.userId).sort()).toEqual([CHAIR, SECRETARY]);
    expect(conversation.unreadCount).toBe(0); // the sender has nothing unread
    expect(message.sender?.userId).toBe(OWNER1);

    // Every officer sees it in their inbox, unread.
    for (const officer of [CHAIR, SECRETARY]) {
      const inbox = await messaging.listConversations(ctx(userActor(officer)), schemeId, officer);
      const row = inbox.conversations.find((c) => c.id === conversation.id);
      expect(row).toBeDefined();
      expect(row!.unreadCount).toBe(1);
      expect(row!.lastMessage!.body).toContain("doubled up");
      expect(row!.lastMessage!.senderUserId).toBe(OWNER1);
      expect(row!.otherParticipants.map((p) => p.userId)).toContain(OWNER1);
    }
  });

  it("a later-appointed officer does NOT see earlier committee threads (snapshot)", async () => {
    const { conversation } = await messaging.startConversation(ctx(userActor(TENANT)), schemeId, {
      body: "Private question for the committee of today",
      to: { kind: "committee" },
    });

    // OWNER2 joins the committee AFTER the thread began.
    const appointed = await tdb.db
      .insert(memberships)
      .values({ schemeId, userId: OWNER2, role: "committee_member", startedOn: "2026-07-05" })
      .returning();
    try {
      const inbox = await messaging.listConversations(ctx(userActor(OWNER2)), schemeId, OWNER2);
      expect(inbox.conversations.find((c) => c.id === conversation.id)).toBeUndefined();
      await expect(
        messaging.listMessages(ctx(userActor(OWNER2)), schemeId, conversation.id, OWNER2),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await tdb.db.delete(memberships).where(eq(memberships.id, appointed[0]!.id));
    }
  });

  it("member → a specific officer is allowed; officer → any member is allowed", async () => {
    const toOfficer = await messaging.startConversation(ctx(userActor(OWNER2)), schemeId, {
      body: "Chair, can we talk about the fence?",
      to: { kind: "user", userId: CHAIR },
    });
    expect(toOfficer.conversation.otherParticipants.map((p) => p.userId)).toEqual([CHAIR]);

    const fromOfficer = await messaging.startConversation(ctx(userActor(CHAIR)), schemeId, {
      body: "Your car is blocking the driveway",
      to: { kind: "user", userId: TENANT },
    });
    expect(fromOfficer.conversation.otherParticipants.map((p) => p.userId)).toEqual([TENANT]);
  });

  it("rejects plain member↔member conversations", async () => {
    await expect(
      messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
        body: "psst, neighbour",
        to: { kind: "user", userId: OWNER2 },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s a target who is not an active member, without leaking membership", async () => {
    await expect(
      messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
        body: "hello?",
        to: { kind: "user", userId: OUTSIDER },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects self-DMs, non-member callers, and non-user actors", async () => {
    await expect(
      messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
        body: "note to self",
        to: { kind: "user", userId: OWNER1 },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      messaging.startConversation(ctx(userActor(OUTSIDER)), schemeId, {
        body: "let me in",
        to: { kind: "committee" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      messaging.startConversation(ctx(agentActor("chair", "run-1")), schemeId, {
        body: "beep",
        to: { kind: "committee" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("participant-only access (the 404 pattern)", () => {
  it("a scheme member who is not a participant gets NOT_FOUND everywhere", async () => {
    const { conversation } = await messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
      body: "Between me and the committee",
      to: { kind: "committee" },
    });

    // OWNER2 is a member of the scheme but not in this thread.
    const asOwner2 = ctx(userActor(OWNER2));
    await expect(
      messaging.listMessages(asOwner2, schemeId, conversation.id, OWNER2),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      messaging.sendMessage(asOwner2, schemeId, conversation.id, { body: "let me in" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      messaging.markRead(asOwner2, schemeId, conversation.id, OWNER2),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // And their inbox never lists it.
    const inbox = await messaging.listConversations(asOwner2, schemeId, OWNER2);
    expect(inbox.conversations.find((c) => c.id === conversation.id)).toBeUndefined();

    // A participant probing through the WRONG scheme id also 404s.
    await expect(
      messaging.listMessages(ctx(userActor(OWNER1)), otherSchemeId, conversation.id, OWNER1),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unread counts and markRead", () => {
  it("moves unread as messages arrive and markRead advances the watermark", async () => {
    const { conversation } = await messaging.startConversation(ctx(userActor(OWNER2)), schemeId, {
      subject: "Fence",
      body: "About that fence…",
      to: { kind: "user", userId: CHAIR },
    });

    const chairInbox = () =>
      messaging
        .listConversations(ctx(userActor(CHAIR)), schemeId, CHAIR)
        .then((r) => r.conversations.find((c) => c.id === conversation.id)!);

    expect((await chairInbox()).unreadCount).toBe(1);

    await messaging.markRead(ctx(userActor(CHAIR)), schemeId, conversation.id, CHAIR);
    expect((await chairInbox()).unreadCount).toBe(0);

    await messaging.sendMessage(ctx(userActor(OWNER2)), schemeId, conversation.id, {
      body: "It fell over again",
    });
    await messaging.sendMessage(ctx(userActor(OWNER2)), schemeId, conversation.id, {
      body: "Photos attached to the maintenance request",
    });
    expect((await chairInbox()).unreadCount).toBe(2);

    // The chair replying does not count their own message as unread…
    await messaging.sendMessage(ctx(userActor(CHAIR)), schemeId, conversation.id, {
      body: "On it — raising a work order",
    });
    expect((await chairInbox()).unreadCount).toBe(2);
    // …and the other side only has the chair's reply unread.
    const owner2Inbox = await messaging.listConversations(ctx(userActor(OWNER2)), schemeId, OWNER2);
    expect(owner2Inbox.conversations.find((c) => c.id === conversation.id)!.unreadCount).toBe(1);

    await messaging.markRead(ctx(userActor(CHAIR)), schemeId, conversation.id, CHAIR);
    expect((await chairInbox()).unreadCount).toBe(0);
  });

  it("totalUnread sums across conversations, scheme-scoped", async () => {
    const before = await messaging.totalUnread(ctx(userActor(SECRETARY)), schemeId, SECRETARY);

    await messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
      body: "one for the whole committee",
      to: { kind: "committee" },
    });
    const direct = await messaging.startConversation(ctx(userActor(OWNER2)), schemeId, {
      body: "one just for the secretary",
      to: { kind: "user", userId: SECRETARY },
    });
    await messaging.sendMessage(ctx(userActor(OWNER2)), schemeId, direct.conversation.id, {
      body: "and a follow-up",
    });

    const after = await messaging.totalUnread(ctx(userActor(SECRETARY)), schemeId, SECRETARY);
    expect(after.unread).toBe(before.unread + 3);

    // Nothing bleeds into another scheme's badge.
    const elsewhere = await messaging.totalUnread(
      ctx(userActor(SECRETARY)),
      otherSchemeId,
      SECRETARY,
    );
    expect(elsewhere.unread).toBe(0);
  });
});

describe("messages — listing, soft delete, pagination", () => {
  it("lists newest first and hides soft-deleted messages", async () => {
    const { conversation } = await messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
      body: "first",
      to: { kind: "user", userId: CHAIR },
    });
    const { message: second } = await messaging.sendMessage(
      ctx(userActor(CHAIR)),
      schemeId,
      conversation.id,
      { body: "second" },
    );
    await messaging.sendMessage(ctx(userActor(OWNER1)), schemeId, conversation.id, {
      body: "third",
    });

    let page = await messaging.listMessages(
      ctx(userActor(OWNER1)),
      schemeId,
      conversation.id,
      OWNER1,
    );
    expect(page.messages.map((m) => m.body)).toEqual(["third", "second", "first"]);
    expect(page.messages[1]!.sender?.userId).toBe(CHAIR);

    // Soft-delete the middle message: it drops from the thread and the unread count.
    await tdb.db
      .update(conversationMessages)
      .set({ deletedAt: new Date() })
      .where(eq(conversationMessages.id, second.id));
    page = await messaging.listMessages(ctx(userActor(OWNER1)), schemeId, conversation.id, OWNER1);
    expect(page.messages.map((m) => m.body)).toEqual(["third", "first"]);

    const inbox = await messaging.listConversations(ctx(userActor(OWNER1)), schemeId, OWNER1);
    const row = inbox.conversations.find((c) => c.id === conversation.id)!;
    expect(row.unreadCount).toBe(0); // "second" (the chair's only message) is deleted
    expect(row.lastMessage!.body).toBe("third");
  });

  it("pages a long thread with no skips or duplicates", async () => {
    const { conversation } = await messaging.startConversation(ctx(userActor(OWNER2)), schemeId, {
      body: "msg 0",
      to: { kind: "user", userId: CHAIR },
    });
    for (let i = 1; i < 55; i++) {
      await messaging.sendMessage(ctx(userActor(OWNER2)), schemeId, conversation.id, {
        body: `msg ${i}`,
      });
    }

    const page1 = await messaging.listMessages(
      ctx(userActor(CHAIR)),
      schemeId,
      conversation.id,
      CHAIR,
    );
    expect(page1.messages).toHaveLength(50);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.messages[0]!.body).toBe("msg 54"); // newest first

    const page2 = await messaging.listMessages(
      ctx(userActor(CHAIR)),
      schemeId,
      conversation.id,
      CHAIR,
      page1.nextCursor,
    );
    expect(page2.messages).toHaveLength(5);
    expect(page2.nextCursor).toBeUndefined();

    const seen = [...page1.messages, ...page2.messages].map((m) => m.id);
    expect(new Set(seen).size).toBe(55);

    const badge = await messaging.totalUnread(ctx(userActor(CHAIR)), schemeId, CHAIR);
    expect(badge.unread).toBeGreaterThanOrEqual(55);
  });
});

describe("notification fan-out (the notifier case)", () => {
  it("notifies the other participants — never the sender — in-app and by email", async () => {
    memoryEmail.sent.length = 0;

    const { conversation } = await messaging.startConversation(ctx(userActor(OWNER1)), schemeId, {
      subject: "Broken gate",
      body: "The pedestrian gate lock is broken — please don't share this widely",
      to: { kind: "committee" },
    });

    const event = await latestMessageEvent(conversation.id);
    expect(event.payload).toMatchObject({
      conversationId: conversation.id,
      senderUserId: OWNER1,
    });

    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      event,
    );
    expect(created).toBe(2); // chair + secretary; NOT the sender

    for (const officer of [CHAIR, SECRETARY]) {
      const rows = await notificationsService.listNotifications(
        ctx(systemActor("test")),
        schemeId,
        officer,
        { unreadOnly: true },
      );
      const match = rows.find((n) => n.related?.id === conversation.id);
      expect(match).toMatchObject({
        category: "general",
        title: `New message from Name ${OWNER1}`,
        related: { type: "conversation", id: conversation.id },
      });
    }
    const senderRows = await notificationsService.listNotifications(
      ctx(systemActor("test")),
      schemeId,
      OWNER1,
      { unreadOnly: true },
    );
    expect(senderRows.some((n) => n.related?.id === conversation.id)).toBe(false);

    // Default prefs: email ON for messages — the two officers, never the sender.
    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      `${CHAIR}@example.com`,
      `${SECRETARY}@example.com`,
    ]);
    // Privacy: the notification email never carries the message body.
    for (const sent of memoryEmail.sent) {
      expect(sent.text).not.toContain("please don't share this widely");
    }
  });

  it("a reply notifies the thread starter (sender flipped)", async () => {
    memoryEmail.sent.length = 0;

    const { conversation } = await messaging.startConversation(ctx(userActor(OWNER2)), schemeId, {
      body: "Is the AGM date locked in?",
      to: { kind: "user", userId: CHAIR },
    });
    await messaging.sendMessage(ctx(userActor(CHAIR)), schemeId, conversation.id, {
      body: "Yes — 12 August",
    });

    const event = await latestMessageEvent(conversation.id);
    expect(event.payload).toMatchObject({ senderUserId: CHAIR });

    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      event,
    );
    expect(created).toBe(1);
    expect(memoryEmail.sent.map((e) => e.to)).toEqual([`${OWNER2}@example.com`]);
  });
});
