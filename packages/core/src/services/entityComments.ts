/**
 * Comment threads on maintenance requests and grievance complaints — the
 * two-way discussion between the member who raised the matter and the
 * officers handling it. One polymorphic table (entity_comments) serves both;
 * access rules are derived from each entity's existing model:
 *
 *  - maintenance_request: the requester (reportedByPersonId → their login)
 *    plus the officer tier. Requests themselves are listed to every member,
 *    so a non-participant gets an honest 403.
 *  - complaint: the complainant plus the officer tier. The grievance register
 *    is officer-only and a complaint's existence is confidential — a
 *    non-participant (the respondent included) gets 404, never 403, so the
 *    thread endpoint can't be used to probe whether a complaint exists.
 *
 * The assigned contractor is deliberately NOT a participant: contractors have
 * no login — the portal authenticates them per work order with an unguessable
 * token under a system actor — so admitting them here would mean growing the
 * public token surface. Officers relay anything the contractor needs.
 */
import { complaints, entityComments, maintenanceRequests, people, users } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import type { CommentEntityType, MembershipRole } from "@goodstrata/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

/**
 * The officer tier that can see and work every thread — the same set the
 * maintenance/grievance route guards accept (requireRole("chair", "secretary",
 * "treasurer") with manager_admin always passing). Shared with the notifier so
 * fan-out never reaches someone who can't open the thread.
 */
export const THREAD_OFFICER_ROLES: readonly MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "manager_admin",
];

export const createEntityCommentInput = z.object({ body: z.string().min(1).max(5000) });
export type CreateEntityCommentInput = z.infer<typeof createEntityCommentInput>;

/** Who is asking — the session user plus the route's role verdict. */
export interface ThreadAccess {
  /** The signed-in user (from the session, never the payload). */
  userId: string;
  /** Holds one of THREAD_OFFICER_ROLES in this scheme — computed by the route. */
  isOfficer: boolean;
}

export interface EntityCommentView {
  id: string;
  body: string;
  author: { userId: string; name: string; image: string | null };
  createdAt: string;
}

/** Commenting is keyed to the login membership — reject agent/system actors. */
function requireUserActor(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Commenting requires a signed-in member", 403);
  }
  return ctx.actor.id;
}

/** The user's person record in this scheme, if their login is linked to one. */
async function personIdForUser(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
): Promise<string | null> {
  const person = await ctx.db.query.people.findFirst({
    where: and(eq(people.schemeId, schemeId), eq(people.userId, userId)),
  });
  return person?.id ?? null;
}

/**
 * Assert the caller may see (and write) the thread. Both operations share one
 * rule — a thread you can read is a thread you can reply on.
 */
async function assertThreadParticipant(
  ctx: ServiceContext,
  schemeId: string,
  entityType: CommentEntityType,
  entityId: string,
  access: ThreadAccess,
): Promise<void> {
  switch (entityType) {
    case "maintenance_request": {
      const request = await ctx.db.query.maintenanceRequests.findFirst({
        where: and(
          eq(maintenanceRequests.id, entityId),
          eq(maintenanceRequests.schemeId, schemeId),
        ),
      });
      if (!request) throw notFound("Maintenance request");
      if (access.isOfficer) return;
      const personId = await personIdForUser(ctx, schemeId, access.userId);
      if (personId && request.reportedByPersonId === personId) return;
      // Requests are listed to every member — existence isn't secret, so an
      // honest 403 tells a non-participant the thread is not theirs to read.
      throw new DomainError(
        "FORBIDDEN",
        "Only the requester and officers can view this thread",
        403,
      );
    }
    case "complaint": {
      const complaint = await ctx.db.query.complaints.findFirst({
        where: and(eq(complaints.id, entityId), eq(complaints.schemeId, schemeId)),
      });
      if (!complaint) throw notFound("Complaint");
      if (access.isOfficer) return;
      const personId = await personIdForUser(ctx, schemeId, access.userId);
      if (personId && complaint.complainantPersonId === personId) return;
      // Confidential: a complaint's existence must not leak to anyone outside
      // the procedure — the respondent included — so non-participants get the
      // same 404 an unknown id would.
      throw notFound("Complaint");
    }
  }
}

/**
 * The thread, oldest first. `authorUserId` is nullable at the schema level
 * (ON DELETE SET NULL) but the read INNER JOINs users — a comment whose author
 * account is gone drops out, same as the community feed.
 */
export async function listComments(
  ctx: ServiceContext,
  schemeId: string,
  entityType: CommentEntityType,
  entityId: string,
  access: ThreadAccess,
): Promise<EntityCommentView[]> {
  await assertThreadParticipant(ctx, schemeId, entityType, entityId, access);

  const rows = await ctx.db
    .select({
      id: entityComments.id,
      body: entityComments.body,
      createdAt: entityComments.createdAt,
      authorUserId: entityComments.authorUserId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(entityComments)
    .innerJoin(users, eq(entityComments.authorUserId, users.id))
    .where(
      and(
        eq(entityComments.schemeId, schemeId),
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId),
        isNull(entityComments.deletedAt),
      ),
    )
    .orderBy(asc(entityComments.createdAt), asc(entityComments.id));

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    author: { userId: r.authorUserId!, name: r.authorName, image: r.authorImage },
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Add a comment to the thread and publish `entity.comment.created`. */
export async function addComment(
  ctx: ServiceContext,
  schemeId: string,
  entityType: CommentEntityType,
  entityId: string,
  access: ThreadAccess,
  input: CreateEntityCommentInput,
): Promise<{ comment: EntityCommentView }> {
  const authorUserId = requireUserActor(ctx);
  await assertThreadParticipant(ctx, schemeId, entityType, entityId, access);

  const comment = await ctx.db.transaction(async (tx) => {
    const comment = (
      await tx
        .insert(entityComments)
        .values({ schemeId, entityType, entityId, authorUserId, body: input.body })
        .returning()
    )[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `${entityType}:${entityId}`,
      type: "entity.comment.created",
      payload: { commentId: comment.id, entityType, entityId, authorUserId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return comment;
  });

  const author = await ctx.db.query.users.findFirst({ where: eq(users.id, authorUserId) });
  return {
    comment: {
      id: comment.id,
      body: comment.body,
      author: {
        userId: authorUserId,
        name: author?.name ?? "Member",
        image: author?.image ?? null,
      },
      createdAt: comment.createdAt.toISOString(),
    },
  };
}

/**
 * Soft-delete a comment (deletedAt stamped). The author may retract their own;
 * officers may remove any (moderation). Publishes `entity.comment.removed`.
 */
export async function deleteComment(
  ctx: ServiceContext,
  schemeId: string,
  commentId: string,
  access: ThreadAccess,
): Promise<{ commentId: string }> {
  const comment = await ctx.db.query.entityComments.findFirst({
    where: and(eq(entityComments.id, commentId), eq(entityComments.schemeId, schemeId)),
  });
  if (!comment || comment.deletedAt) throw notFound("Comment");
  if (comment.authorUserId !== access.userId && !access.isOfficer) {
    throw new DomainError(
      "FORBIDDEN",
      "Only the author or an officer can remove this comment",
      403,
    );
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(entityComments)
      .set({ deletedAt: ctx.clock.now() })
      .where(eq(entityComments.id, commentId));
    await publishEvent(tx, {
      schemeId,
      stream: `${comment.entityType}:${comment.entityId}`,
      type: "entity.comment.removed",
      payload: {
        commentId,
        entityType: comment.entityType,
        entityId: comment.entityId,
        removedBy: access.userId,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
  return { commentId };
}
