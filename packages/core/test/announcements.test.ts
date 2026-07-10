import { memberships, notificationPreferences, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import {
  type Actor,
  agentActor,
  fixedClock,
  type MembershipRole,
  systemActor,
  userActor,
} from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as announcementsService from "../src/services/announcements.js";
import * as notificationsService from "../src/services/notifications.js";
import * as notifierService from "../src/services/notifier.js";

let tdb: TestDatabase;
let schemeId: string;

const CHAIR = "user-chair-a";
const SECRETARY = "user-secretary-a";
const OWNER = "user-owner-a";
const TENANT = "user-tenant-a";

const OFFICER_ROLES: MembershipRole[] = ["chair"];
const OWNER_ROLES: MembershipRole[] = ["owner"];
const TENANT_ROLES: MembershipRole[] = ["tenant"];

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

const NOW = "2026-07-04T00:00:00Z";
function ctx(actor: Actor = userActor(CHAIR)): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

async function newScheme(name: string, pos: string): Promise<string> {
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name,
      planOfSubdivision: pos,
      addressLine1: "7 Notice St",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 3,
      status: "active",
    })
    .returning();
  return rows[0]!.id;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  schemeId = await newScheme("Announce Test OC", "PS777001A");

  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair-a@example.com" },
    { id: SECRETARY, name: "Sam Secretary", email: "secretary-a@example.com" },
    { id: OWNER, name: "Olly Owner", email: "owner-a@example.com" },
    { id: TENANT, name: "Terry Tenant", email: "tenant-a@example.com" },
  ]);
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: SECRETARY, role: "secretary", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: TENANT, role: "tenant", startedOn: "2025-01-01" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("create & publish", () => {
  it("publish-now writes publishedAt and the typed event in one transaction", async () => {
    const a = await announcementsService.createAnnouncement(ctx(), schemeId, {
      title: "Pool closed for repairs",
      body: "The pool is closed until Friday.\n\nSorry for the inconvenience.",
      audience: "all",
      publish: true,
    });
    expect(a.publishedAt).toBe(new Date(NOW).toISOString());

    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.type, "announcement.published"), eq(t.stream, `announcement:${a.id}`)),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({
      id: a.id,
      schemeId,
      title: "Pool closed for repairs",
      audience: "all",
      body: "The pool is closed until Friday.\n\nSorry for the inconvenience.",
    });
  });

  it("a draft publishes no event until published; publishing twice is a 409", async () => {
    const draft = await announcementsService.createAnnouncement(ctx(), schemeId, {
      title: "Draft agenda notes",
      body: "Not ready yet.",
      audience: "committee",
      publish: false,
    });
    expect(draft.publishedAt).toBeNull();

    let events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.stream, `announcement:${draft.id}`),
    });
    expect(events).toHaveLength(0);

    const published = await announcementsService.publishAnnouncement(ctx(), schemeId, draft.id);
    expect(published.publishedAt).not.toBeNull();
    events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.stream, `announcement:${draft.id}`),
    });
    expect(events).toHaveLength(1);

    await expect(
      announcementsService.publishAnnouncement(ctx(), schemeId, draft.id),
    ).rejects.toMatchObject({ code: "ALREADY_PUBLISHED", status: 409 });
  });

  it("publish 404s on a foreign scheme's announcement", async () => {
    const otherScheme = await newScheme("Other Announce OC", "PS777002A");
    const draft = await announcementsService.createAnnouncement(ctx(), otherScheme, {
      title: "Foreign draft",
      body: "…",
      audience: "all",
      publish: false,
    });
    await expect(
      announcementsService.publishAnnouncement(ctx(), schemeId, draft.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("audience visibility", () => {
  let schemeIdVisibility: string;
  let committeeOnly: string;
  let ownersOnly: string;
  let everyone: string;
  let draftId: string;

  beforeAll(async () => {
    const isolated = await newScheme("Visibility OC", "PS777003A");
    schemeIdVisibility = isolated;
    committeeOnly = (
      await announcementsService.createAnnouncement(ctx(), isolated, {
        title: "Committee eyes only",
        body: "Levy strategy discussion.",
        audience: "committee",
        publish: true,
      })
    ).id;
    ownersOnly = (
      await announcementsService.createAnnouncement(ctx(), isolated, {
        title: "Owners: budget preview",
        body: "The draft budget is attached.",
        audience: "owners",
        publish: true,
      })
    ).id;
    everyone = (
      await announcementsService.createAnnouncement(ctx(), isolated, {
        title: "Fire alarm test Tuesday",
        body: "Alarms will sound at 10am.",
        audience: "all",
        publish: true,
      })
    ).id;
    draftId = (
      await announcementsService.createAnnouncement(ctx(), isolated, {
        title: "Unpublished note",
        body: "Still drafting.",
        audience: "all",
        publish: false,
      })
    ).id;
  });

  it("officers see every audience plus drafts", async () => {
    const { announcements: list } = await announcementsService.listAnnouncements(
      ctx(),
      schemeIdVisibility,
      OFFICER_ROLES,
    );
    expect(list.map((a) => a.id).sort()).toEqual(
      [committeeOnly, ownersOnly, everyone, draftId].sort(),
    );
  });

  it("a plain owner sees owners + all, never committee notices or drafts", async () => {
    const { announcements: list } = await announcementsService.listAnnouncements(
      ctx(userActor(OWNER)),
      schemeIdVisibility,
      OWNER_ROLES,
    );
    expect(list.map((a) => a.id).sort()).toEqual([ownersOnly, everyone].sort());

    // The single read 404s (not 403s) so the notice's existence never leaks.
    await expect(
      announcementsService.getAnnouncement(
        ctx(userActor(OWNER)),
        schemeIdVisibility,
        committeeOnly,
        OWNER_ROLES,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      announcementsService.getAnnouncement(
        ctx(userActor(OWNER)),
        schemeIdVisibility,
        draftId,
        OWNER_ROLES,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tenant sees building-wide notices only", async () => {
    const { announcements: list } = await announcementsService.listAnnouncements(
      ctx(userActor(TENANT)),
      schemeIdVisibility,
      TENANT_ROLES,
    );
    expect(list.map((a) => a.id)).toEqual([everyone]);
  });

  it("reads are scheme-scoped", async () => {
    await expect(
      announcementsService.getAnnouncement(ctx(), schemeId, everyone, OFFICER_ROLES),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("pagination", () => {
  it("pages newest-first with no skips or duplicates", async () => {
    const paged = await newScheme("Paged Announce OC", "PS777004A");
    const created: string[] = [];
    for (let i = 0; i < 25; i++) {
      const a = await announcementsService.createAnnouncement(ctx(), paged, {
        title: `Notice ${i}`,
        body: "…",
        audience: "all",
        publish: true,
      });
      created.push(a.id);
    }

    const page1 = await announcementsService.listAnnouncements(ctx(), paged, OFFICER_ROLES);
    expect(page1.announcements).toHaveLength(20);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await announcementsService.listAnnouncements(
      ctx(),
      paged,
      OFFICER_ROLES,
      page1.nextCursor,
    );
    expect(page2.announcements).toHaveLength(5);
    expect(page2.nextCursor).toBeUndefined();

    const seen = [...page1.announcements, ...page2.announcements].map((a) => a.id);
    expect(new Set(seen)).toEqual(new Set(created));
    expect(page1.announcements[0]!.id).toBe(created[created.length - 1]);
  });

  it("does not anchor on a cursor id from another scheme", async () => {
    const probeScheme = await newScheme("Probe Announce OC", "PS777005A");
    const foreign = await announcementsService.createAnnouncement(ctx(), probeScheme, {
      title: "Foreign anchor",
      body: "…",
      audience: "all",
      publish: true,
    });
    const probed = await announcementsService.listAnnouncements(
      ctx(),
      schemeId,
      OFFICER_ROLES,
      foreign.id,
    );
    expect(probed.announcements).toHaveLength(0);
  });
});

describe("edit & delete (author or officer)", () => {
  it("the author edits; another member without the officer tier is refused", async () => {
    const a = await announcementsService.createAnnouncement(ctx(userActor(CHAIR)), schemeId, {
      title: "Editable notice",
      body: "v1",
      audience: "all",
      publish: true,
    });

    // Author (not relying on canManage).
    const edited = await announcementsService.updateAnnouncement(
      ctx(userActor(CHAIR)),
      schemeId,
      a.id,
      { body: "v2" },
      { userId: CHAIR, canManage: false },
    );
    expect(edited.body).toBe("v2");
    expect(edited.title).toBe("Editable notice");

    // A non-author, non-officer member is refused.
    await expect(
      announcementsService.updateAnnouncement(
        ctx(userActor(OWNER)),
        schemeId,
        a.id,
        { body: "vandalised" },
        { userId: OWNER, canManage: false },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(
      announcementsService.deleteAnnouncement(ctx(userActor(OWNER)), schemeId, a.id, {
        userId: OWNER,
        canManage: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // Another officer (canManage) may edit and delete.
    const officerEdit = await announcementsService.updateAnnouncement(
      ctx(userActor(SECRETARY)),
      schemeId,
      a.id,
      { title: "Editable notice (amended)" },
      { userId: SECRETARY, canManage: true },
    );
    expect(officerEdit.title).toBe("Editable notice (amended)");

    await announcementsService.deleteAnnouncement(ctx(userActor(SECRETARY)), schemeId, a.id, {
      userId: SECRETARY,
      canManage: true,
    });
    await expect(
      announcementsService.getAnnouncement(ctx(), schemeId, a.id, OFFICER_ROLES),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an agent-authored announcement is manageable by officers only", async () => {
    const a = await announcementsService.createAnnouncement(
      ctx(agentActor("echo", "run-1")),
      schemeId,
      { title: "Welcome to GoodStrata", body: "Hi!", audience: "all", publish: true },
    );
    await expect(
      announcementsService.deleteAnnouncement(ctx(userActor(OWNER)), schemeId, a.id, {
        userId: OWNER,
        canManage: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await announcementsService.deleteAnnouncement(ctx(userActor(CHAIR)), schemeId, a.id, {
      userId: CHAIR,
      canManage: true,
    });
  });
});

describe("publish → event → notifier fan-out", () => {
  async function publishAndNotify(audience: "all" | "owners" | "committee", title: string) {
    const a = await announcementsService.createAnnouncement(ctx(), schemeId, {
      title,
      body: `Body of ${title}.`,
      audience,
      publish: true,
    });
    const event = await tdb.db.query.eventLog.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.type, "announcement.published"), eq(t.stream, `announcement:${a.id}`)),
    });
    const result = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      event as unknown as EventRecord,
    );
    return { announcement: a, ...result };
  }

  it('audience "all" reaches every member in-app and by email', async () => {
    memoryEmail.sent.length = 0;
    const { announcement, created } = await publishAndNotify("all", "Lift outage Saturday");
    expect(created).toBe(4); // chair, secretary, owner, tenant

    const ownerRows = await notificationsService.listNotifications(ctx(), schemeId, OWNER, {
      unreadOnly: true,
    });
    const bell = ownerRows.find((n) => n.related?.id === announcement.id);
    expect(bell).toMatchObject({
      title: "Lift outage Saturday",
      category: "general",
      related: { type: "announcement", id: announcement.id },
    });

    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "chair-a@example.com",
      "owner-a@example.com",
      "secretary-a@example.com",
      "tenant-a@example.com",
    ]);
    expect(memoryEmail.sent[0]!.subject).toBe("Announcement: Lift outage Saturday");
    expect(memoryEmail.sent[0]!.text).toContain("Body of Lift outage Saturday.");
  });

  it('audience "committee" never reaches a plain owner or tenant', async () => {
    memoryEmail.sent.length = 0;
    const { announcement, created } = await publishAndNotify("committee", "Quorum planning");
    expect(created).toBe(2); // chair + secretary only

    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "chair-a@example.com",
      "secretary-a@example.com",
    ]);
    for (const userId of [OWNER, TENANT]) {
      const rows = await notificationsService.listNotifications(ctx(), schemeId, userId, {
        unreadOnly: true,
      });
      expect(rows.some((n) => n.related?.id === announcement.id)).toBe(false);
    }
  });

  it('audience "owners" reaches owners and officers, not tenants', async () => {
    memoryEmail.sent.length = 0;
    const { created } = await publishAndNotify("owners", "AGM date poll");
    expect(created).toBe(3); // chair, secretary, owner — not the tenant

    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "chair-a@example.com",
      "owner-a@example.com",
      "secretary-a@example.com",
    ]);
  });

  it("a recipient's email opt-out is honoured; the bell row still lands", async () => {
    await tdb.db.insert(notificationPreferences).values({
      userId: OWNER,
      notificationType: "announcement.published",
      channel: "email",
      enabled: false,
    });

    memoryEmail.sent.length = 0;
    const { announcement, created } = await publishAndNotify("all", "Recycling reminder");
    expect(created).toBe(4); // in-app unaffected

    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "chair-a@example.com",
      "secretary-a@example.com",
      "tenant-a@example.com",
    ]);
    const ownerRows = await notificationsService.listNotifications(ctx(), schemeId, OWNER, {
      unreadOnly: true,
    });
    expect(ownerRows.some((n) => n.related?.id === announcement.id)).toBe(true);
  });
});
