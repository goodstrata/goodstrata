import { announcements } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  type Actor,
  ANNOUNCEMENT_AUDIENCES,
  type AnnouncementAudience,
  type MembershipRole,
} from "@goodstrata/shared";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

/**
 * Announcements: the committee's noticeboard. Officers post notices addressed
 * to an audience ("all" members, lot "owners", or the "committee" itself);
 * publishing appends `announcement.published` to the outbox in the same
 * transaction, and the notifier fans it out in-app + email to that audience.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const createAnnouncementInput = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(1).max(10_000),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).default("all"),
  /** Publish immediately, or save as a draft (default) to publish later. */
  publish: z.boolean().default(false),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementInput>;

export const updateAnnouncementInput = z
  .object({
    title: z.string().min(3).max(200).optional(),
    body: z.string().min(1).max(10_000).optional(),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined || v.audience !== undefined, {
    message: "Nothing to update",
  });
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementInput>;

// ---------------------------------------------------------------------------
// Audience tiers
// ---------------------------------------------------------------------------

/**
 * Roles that make an "officer" for announcements — may create/publish, and may
 * read committee-audience notices. Same tier as documents' committee records
 * and the community board's moderators.
 */
const OFFICER_ROLES: ReadonlySet<MembershipRole> = new Set([
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
]);

export function isAnnouncementOfficer(roles: readonly MembershipRole[]): boolean {
  return roles.some((r) => OFFICER_ROLES.has(r));
}

/**
 * The audiences a member with these roles may read. Officers see everything;
 * lot owners see owner-addressed and building-wide notices; everyone else
 * (tenants, contractors) sees building-wide only. Single source of truth for
 * both the list and the single-item read, so the list never shows a notice the
 * member would then be refused.
 */
export function audiencesForRoles(roles: readonly MembershipRole[]): AnnouncementAudience[] {
  if (isAnnouncementOfficer(roles)) return ["all", "owners", "committee"];
  if (roles.includes("owner")) return ["all", "owners"];
  return ["all"];
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  publishedAt: string | null;
  createdBy: Actor;
  createdAt: string;
}

type AnnouncementRow = typeof announcements.$inferSelect;

function toView(row: AnnouncementRow): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience as AnnouncementAudience,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdBy: row.createdBy as Actor,
    createdAt: row.createdAt.toISOString(),
  };
}

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keyset cursor (the last item's id), anchored on that row's (created_at, id)
 * inside Postgres — same shape as the community feed, and scheme-scoped so a
 * cursor can't probe whether an announcement id exists in another scheme.
 */
function cursorFilter(schemeId: string, cursor: string | undefined) {
  if (!cursor || !UUID_RE.test(cursor)) return undefined;
  return sql`(${announcements.createdAt}, ${announcements.id}) < (select a.created_at, a.id from ${announcements} as a where a.id = ${cursor} and a.scheme_id = ${schemeId})`;
}

/** The audience/draft visibility predicate for a member with these roles. */
function visibilityFilter(roles: readonly MembershipRole[]) {
  const audiences = audiencesForRoles(roles);
  const audienceFilter = inArray(announcements.audience, audiences);
  // Drafts are the officers' workbench — everyone else sees published only.
  return isAnnouncementOfficer(roles)
    ? audienceFilter
    : and(audienceFilter, isNotNull(announcements.publishedAt));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Newest-first noticeboard, filtered to what the caller's roles may read. */
export async function listAnnouncements(
  ctx: ServiceContext,
  schemeId: string,
  roles: readonly MembershipRole[],
  cursor?: string,
): Promise<{ announcements: AnnouncementView[]; nextCursor?: string }> {
  const rows = await ctx.db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.schemeId, schemeId),
        visibilityFilter(roles),
        cursorFilter(schemeId, cursor),
      ),
    )
    .orderBy(desc(announcements.createdAt), desc(announcements.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    announcements: page.map(toView),
    nextCursor: hasMore ? page[page.length - 1]!.id : undefined,
  };
}

/** One announcement — 404 (not 403) when outside the caller's audience, so
 *  committee-only notices are never confirmed to exist. */
export async function getAnnouncement(
  ctx: ServiceContext,
  schemeId: string,
  announcementId: string,
  roles: readonly MembershipRole[],
): Promise<AnnouncementView> {
  const rows = await ctx.db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.id, announcementId),
        eq(announcements.schemeId, schemeId),
        visibilityFilter(roles),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Announcement");
  return toView(row);
}

// ---------------------------------------------------------------------------
// Writes (routes gate these to the officer tier)
// ---------------------------------------------------------------------------

function publishedPayload(row: AnnouncementRow) {
  return {
    id: row.id,
    schemeId: row.schemeId,
    title: row.title,
    audience: row.audience as AnnouncementAudience,
    body: row.body,
  };
}

/**
 * Create an announcement — a draft, or published immediately. Publishing
 * writes `publishedAt` and appends `announcement.published` in the same
 * transaction (the outbox), so the notice and its fan-out commit atomically.
 */
export async function createAnnouncement(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateAnnouncementInput,
): Promise<AnnouncementView> {
  return await ctx.db.transaction(async (tx) => {
    const row = (
      await tx
        .insert(announcements)
        .values({
          schemeId,
          title: input.title,
          body: input.body,
          audience: input.audience,
          publishedAt: input.publish ? ctx.clock.now() : null,
          createdBy: ctx.actor,
        })
        .returning()
    )[0]!;

    if (input.publish) {
      await publishEvent(tx, {
        schemeId,
        stream: `announcement:${row.id}`,
        type: "announcement.published",
        payload: publishedPayload(row),
        actor: ctx.actor,
        ...causationFields(ctx),
      });
    }
    return toView(row);
  });
}

/** Publish a draft. Publishing twice is a 409, never a double fan-out. */
export async function publishAnnouncement(
  ctx: ServiceContext,
  schemeId: string,
  announcementId: string,
): Promise<AnnouncementView> {
  return await ctx.db.transaction(async (tx) => {
    const existing = await tx.query.announcements.findFirst({
      where: and(eq(announcements.id, announcementId), eq(announcements.schemeId, schemeId)),
    });
    if (!existing) throw notFound("Announcement");
    if (existing.publishedAt) {
      throw new DomainError("ALREADY_PUBLISHED", "Announcement is already published", 409);
    }

    const row = (
      await tx
        .update(announcements)
        .set({ publishedAt: ctx.clock.now() })
        .where(eq(announcements.id, announcementId))
        .returning()
    )[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `announcement:${row.id}`,
      type: "announcement.published",
      payload: publishedPayload(row),
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return toView(row);
  });
}

/** Only the author (or any current officer) may edit or delete a notice. */
function requireAuthorOrOfficer(
  row: AnnouncementRow,
  opts: { userId: string; canManage: boolean },
  action: string,
) {
  const author = row.createdBy as Actor;
  const isAuthor = author.kind === "user" && author.id === opts.userId;
  if (!isAuthor && !opts.canManage) {
    throw new DomainError(
      "FORBIDDEN",
      `Only the author or an officer can ${action} this announcement`,
      403,
    );
  }
}

/**
 * Edit title/body/audience. Allowed on drafts and published notices alike
 * (typo fixes stay ordinary); edits after publish never re-notify.
 */
export async function updateAnnouncement(
  ctx: ServiceContext,
  schemeId: string,
  announcementId: string,
  input: UpdateAnnouncementInput,
  opts: { userId: string; canManage: boolean },
): Promise<AnnouncementView> {
  const existing = await ctx.db.query.announcements.findFirst({
    where: and(eq(announcements.id, announcementId), eq(announcements.schemeId, schemeId)),
  });
  if (!existing) throw notFound("Announcement");
  requireAuthorOrOfficer(existing, opts, "edit");

  const row = (
    await ctx.db
      .update(announcements)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.audience !== undefined ? { audience: input.audience } : {}),
      })
      .where(eq(announcements.id, announcementId))
      .returning()
  )[0]!;
  return toView(row);
}

/** Remove a notice (hard delete — the table has no tombstone column). */
export async function deleteAnnouncement(
  ctx: ServiceContext,
  schemeId: string,
  announcementId: string,
  opts: { userId: string; canManage: boolean },
): Promise<{ announcementId: string }> {
  const existing = await ctx.db.query.announcements.findFirst({
    where: and(eq(announcements.id, announcementId), eq(announcements.schemeId, schemeId)),
  });
  if (!existing) throw notFound("Announcement");
  requireAuthorOrOfficer(existing, opts, "remove");

  await ctx.db.delete(announcements).where(eq(announcements.id, announcementId));
  return { announcementId };
}
