import {
  communityCommentLikes,
  communityComments,
  communityPostImages,
  communityPostLikes,
  communityPosts,
  users,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { storageKey } from "@goodstrata/integrations";
import type { CommunityPostStatus } from "@goodstrata/shared";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const createPostInput = z.object({ body: z.string().min(1).max(5000) });
export type CreatePostInput = z.infer<typeof createPostInput>;

export const createCommentInput = z.object({ body: z.string().min(1).max(5000) });
export type CreateCommentInput = z.infer<typeof createCommentInput>;

/** A file the route has read off multipart form-data, ready for storage. */
export interface PostImageUpload {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

// ---------------------------------------------------------------------------
// Read models (the shapes the web feed renders)
// ---------------------------------------------------------------------------

export interface PostAuthor {
  userId: string;
  name: string;
  image: string | null;
}

/**
 * `communityPosts.authorUserId` / `communityComments.authorUserId` are
 * nullable at the schema level (ON DELETE SET NULL severs a deleted author's
 * link), but every feed/thread read below INNER JOINs on `users` — a post or
 * comment whose author account is gone simply drops out of the join, so the
 * `!` assertions on `authorUserId` further down are safe.
 */

export interface PostImageView {
  id: string;
  mime: string;
}

export interface PostSummary {
  id: string;
  body: string;
  status: CommunityPostStatus;
  author: PostAuthor;
  images: PostImageView[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
}

export interface CommentView {
  id: string;
  body: string;
  author: PostAuthor;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
}

export interface ThreadView extends PostSummary {
  comments: CommentView[];
}

const FEED_PAGE_SIZE = 20;
const MAX_IMAGES_PER_POST = 8;

/** Posting is keyed to the login membership — reject agent/system actors. */
function requireUserActor(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Community posting requires a signed-in member", 403);
  }
  return ctx.actor.id;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/**
 * Create a post with zero-or-more images. Images are written to object storage
 * first (S3 puts aren't transactional), then the post row, its image rows, and
 * the community.post.created event are committed in one transaction.
 */
export async function createPost(
  ctx: ServiceContext,
  schemeId: string,
  input: CreatePostInput,
  files: PostImageUpload[] = [],
): Promise<PostSummary> {
  const authorUserId = requireUserActor(ctx);
  if (files.length > MAX_IMAGES_PER_POST) {
    throw new DomainError("TOO_MANY_IMAGES", `At most ${MAX_IMAGES_PER_POST} images per post`, 422);
  }

  const stored = await Promise.all(
    files.map(async (file, index) => {
      const key = storageKey(schemeId, file.filename);
      await ctx.integrations.storage.put(key, file.content, file.contentType);
      return {
        storageKey: key,
        mime: file.contentType || "application/octet-stream",
        sizeBytes: file.content.byteLength,
        position: index,
      };
    }),
  );

  const { post, imageRows } = await ctx.db.transaction(async (tx) => {
    const post = (
      await tx
        .insert(communityPosts)
        .values({ schemeId, authorUserId, body: input.body })
        .returning()
    )[0]!;

    const imageRows =
      stored.length > 0
        ? await tx
            .insert(communityPostImages)
            .values(stored.map((s) => ({ schemeId, postId: post.id, ...s })))
            .returning({ id: communityPostImages.id, mime: communityPostImages.mime })
        : [];

    await publishEvent(tx, {
      schemeId,
      stream: `community_post:${post.id}`,
      type: "community.post.created",
      payload: { postId: post.id, authorUserId, imageCount: imageRows.length },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return { post, imageRows };
  });

  const author = await loadAuthor(ctx, authorUserId);
  return {
    id: post.id,
    body: post.body,
    status: post.status,
    author,
    images: imageRows.map((r) => ({ id: r.id, mime: r.mime })),
    likeCount: 0,
    commentCount: 0,
    likedByMe: false,
    createdAt: post.createdAt.toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keyset cursor for the feed. The cursor is the last post's id: the comparison
 * anchors on that row's (created_at, id) inside Postgres, because a JS Date is
 * millisecond-precision while Postgres timestamps carry microseconds — pulling
 * createdAt out and comparing in JS (or via toISOString) silently skips posts
 * that share a millisecond. Legacy ISO-date cursors still work (in-flight
 * clients from before the cursor became an id).
 *
 * The anchor lookup is scheme-scoped so a cursor can't be used to probe
 * whether a post id exists in some other scheme.
 */
function feedCursorFilter(schemeId: string, cursor: string | undefined) {
  if (!cursor) return undefined;
  if (UUID_RE.test(cursor)) {
    return sql`(${communityPosts.createdAt}, ${communityPosts.id}) < (select p.created_at, p.id from ${communityPosts} as p where p.id = ${cursor} and p.scheme_id = ${schemeId})`;
  }
  const asDate = new Date(cursor);
  return Number.isNaN(asDate.getTime()) ? undefined : lt(communityPosts.createdAt, asDate);
}

/** Newest-first scheme feed, keyset-paginated on (createdAt, id). */
export async function listFeed(
  ctx: ServiceContext,
  schemeId: string,
  currentUserId: string,
  cursor?: string,
): Promise<{ posts: PostSummary[]; nextCursor?: string }> {
  const rows = await ctx.db
    .select({
      id: communityPosts.id,
      body: communityPosts.body,
      status: communityPosts.status,
      createdAt: communityPosts.createdAt,
      authorUserId: communityPosts.authorUserId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(communityPosts)
    .innerJoin(users, eq(communityPosts.authorUserId, users.id))
    .where(
      and(
        eq(communityPosts.schemeId, schemeId),
        eq(communityPosts.status, "visible"),
        feedCursorFilter(schemeId, cursor),
      ),
    )
    .orderBy(desc(communityPosts.createdAt), desc(communityPosts.id))
    .limit(FEED_PAGE_SIZE + 1);

  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  if (page.length === 0) return { posts: [] };

  const postIds = page.map((p) => p.id);
  const [images, likeCounts, commentCounts, myLikes] = await Promise.all([
    postImagesFor(ctx, postIds),
    postLikeCounts(ctx, postIds),
    postCommentCounts(ctx, postIds),
    myPostLikes(ctx, postIds, currentUserId),
  ]);

  const posts = page.map((p) => ({
    id: p.id,
    body: p.body,
    status: p.status,
    author: { userId: p.authorUserId!, name: p.authorName, image: p.authorImage },
    images: images.get(p.id) ?? [],
    likeCount: likeCounts.get(p.id) ?? 0,
    commentCount: commentCounts.get(p.id) ?? 0,
    likedByMe: myLikes.has(p.id),
    createdAt: p.createdAt.toISOString(),
  }));

  const nextCursor = hasMore ? page[page.length - 1]!.id : undefined;
  return { posts, nextCursor };
}

/** A single post with its full comment thread. */
export async function getThread(
  ctx: ServiceContext,
  schemeId: string,
  postId: string,
  currentUserId: string,
): Promise<{ post: ThreadView }> {
  const postRows = await ctx.db
    .select({
      id: communityPosts.id,
      body: communityPosts.body,
      status: communityPosts.status,
      createdAt: communityPosts.createdAt,
      authorUserId: communityPosts.authorUserId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(communityPosts)
    .innerJoin(users, eq(communityPosts.authorUserId, users.id))
    .where(
      and(
        eq(communityPosts.id, postId),
        eq(communityPosts.schemeId, schemeId),
        eq(communityPosts.status, "visible"),
      ),
    )
    .limit(1);
  const p = postRows[0];
  if (!p) throw notFound("Post");

  const [images, likeCounts, myLikes] = await Promise.all([
    postImagesFor(ctx, [postId]),
    postLikeCounts(ctx, [postId]),
    myPostLikes(ctx, [postId], currentUserId),
  ]);

  const commentRows = await ctx.db
    .select({
      id: communityComments.id,
      body: communityComments.body,
      createdAt: communityComments.createdAt,
      authorUserId: communityComments.authorUserId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(communityComments)
    .innerJoin(users, eq(communityComments.authorUserId, users.id))
    .where(and(eq(communityComments.postId, postId), eq(communityComments.status, "visible")))
    .orderBy(communityComments.createdAt);

  const commentIds = commentRows.map((c) => c.id);
  const [commentLikeCounts, myCommentLikeSet] = await Promise.all([
    commentLikeCountsFor(ctx, commentIds),
    myCommentLikes(ctx, commentIds, currentUserId),
  ]);

  const comments: CommentView[] = commentRows.map((c) => ({
    id: c.id,
    body: c.body,
    author: { userId: c.authorUserId!, name: c.authorName, image: c.authorImage },
    likeCount: commentLikeCounts.get(c.id) ?? 0,
    likedByMe: myCommentLikeSet.has(c.id),
    createdAt: c.createdAt.toISOString(),
  }));

  return {
    post: {
      id: p.id,
      body: p.body,
      status: p.status,
      author: { userId: p.authorUserId!, name: p.authorName, image: p.authorImage },
      images: images.get(p.id) ?? [],
      likeCount: likeCounts.get(p.id) ?? 0,
      commentCount: comments.length,
      likedByMe: myLikes.has(p.id),
      createdAt: p.createdAt.toISOString(),
      comments,
    },
  };
}

/** Load an image row (scheme-scoped) plus its bytes, for the content endpoint. */
export async function getPostImage(ctx: ServiceContext, schemeId: string, imageId: string) {
  const row = await ctx.db.query.communityPostImages.findFirst({
    where: and(eq(communityPostImages.id, imageId), eq(communityPostImages.schemeId, schemeId)),
  });
  if (!row) throw notFound("Image");
  const bytes = await ctx.integrations.storage.get(row.storageKey);
  return { row, bytes };
}

/** Soft-delete a post (status → removed). Author or an officer. */
export async function deletePost(
  ctx: ServiceContext,
  schemeId: string,
  postId: string,
  opts: { userId: string; canModerate: boolean },
) {
  const post = await ctx.db.query.communityPosts.findFirst({
    where: and(eq(communityPosts.id, postId), eq(communityPosts.schemeId, schemeId)),
  });
  if (!post || post.status === "removed") throw notFound("Post");
  if (post.authorUserId !== opts.userId && !opts.canModerate) {
    throw new DomainError("FORBIDDEN", "Only the author or an officer can remove this post", 403);
  }

  await ctx.db.transaction(async (tx) => {
    await tx.update(communityPosts).set({ status: "removed" }).where(eq(communityPosts.id, postId));
    await publishEvent(tx, {
      schemeId,
      stream: `community_post:${postId}`,
      type: "community.post.removed",
      payload: { postId, removedBy: opts.userId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
  return { postId };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addComment(
  ctx: ServiceContext,
  schemeId: string,
  postId: string,
  input: CreateCommentInput,
): Promise<{ comment: CommentView }> {
  const authorUserId = requireUserActor(ctx);

  const comment = await ctx.db.transaction(async (tx) => {
    const post = await tx.query.communityPosts.findFirst({
      where: and(eq(communityPosts.id, postId), eq(communityPosts.schemeId, schemeId)),
    });
    if (!post || post.status === "removed") throw notFound("Post");

    const comment = (
      await tx
        .insert(communityComments)
        .values({ schemeId, postId, authorUserId, body: input.body })
        .returning()
    )[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `community_post:${postId}`,
      type: "community.comment.created",
      payload: { commentId: comment.id, postId, authorUserId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return comment;
  });

  const author = await loadAuthor(ctx, authorUserId);
  return {
    comment: {
      id: comment.id,
      body: comment.body,
      author,
      likeCount: 0,
      likedByMe: false,
      createdAt: comment.createdAt.toISOString(),
    },
  };
}

/** Soft-delete a comment (status → removed). Author or an officer. */
export async function deleteComment(
  ctx: ServiceContext,
  schemeId: string,
  commentId: string,
  opts: { userId: string; canModerate: boolean },
) {
  const comment = await ctx.db.query.communityComments.findFirst({
    where: and(eq(communityComments.id, commentId), eq(communityComments.schemeId, schemeId)),
  });
  if (!comment || comment.status === "removed") throw notFound("Comment");
  if (comment.authorUserId !== opts.userId && !opts.canModerate) {
    throw new DomainError(
      "FORBIDDEN",
      "Only the author or an officer can remove this comment",
      403,
    );
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(communityComments)
      .set({ status: "removed" })
      .where(eq(communityComments.id, commentId));
    await publishEvent(tx, {
      schemeId,
      stream: `community_post:${comment.postId}`,
      type: "community.comment.removed",
      payload: { commentId, postId: comment.postId, removedBy: opts.userId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
  return { commentId };
}

// ---------------------------------------------------------------------------
// Reactions (likes) — a toggle; every direction emits an event.
// ---------------------------------------------------------------------------

export async function togglePostLike(
  ctx: ServiceContext,
  schemeId: string,
  postId: string,
  userId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  return await ctx.db.transaction(async (tx) => {
    const post = await tx.query.communityPosts.findFirst({
      where: and(eq(communityPosts.id, postId), eq(communityPosts.schemeId, schemeId)),
    });
    if (!post || post.status === "removed") throw notFound("Post");

    const existing = await tx.query.communityPostLikes.findFirst({
      where: and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.userId, userId)),
    });

    let liked: boolean;
    if (existing) {
      await tx.delete(communityPostLikes).where(eq(communityPostLikes.id, existing.id));
      liked = false;
    } else {
      await tx.insert(communityPostLikes).values({ schemeId, postId, userId });
      liked = true;
    }

    await publishEvent(tx, {
      schemeId,
      stream: `community_post:${postId}`,
      type: "community.post.reacted",
      payload: { postId, userId, reaction: "like", active: liked },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(communityPostLikes)
      .where(eq(communityPostLikes.postId, postId));
    return { liked, likeCount: countRows[0]?.count ?? 0 };
  });
}

export async function toggleCommentLike(
  ctx: ServiceContext,
  schemeId: string,
  commentId: string,
  userId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  return await ctx.db.transaction(async (tx) => {
    const comment = await tx.query.communityComments.findFirst({
      where: and(eq(communityComments.id, commentId), eq(communityComments.schemeId, schemeId)),
    });
    if (!comment || comment.status === "removed") throw notFound("Comment");

    const existing = await tx.query.communityCommentLikes.findFirst({
      where: and(
        eq(communityCommentLikes.commentId, commentId),
        eq(communityCommentLikes.userId, userId),
      ),
    });

    let liked: boolean;
    if (existing) {
      await tx.delete(communityCommentLikes).where(eq(communityCommentLikes.id, existing.id));
      liked = false;
    } else {
      await tx.insert(communityCommentLikes).values({ schemeId, commentId, userId });
      liked = true;
    }

    await publishEvent(tx, {
      schemeId,
      stream: `community_post:${comment.postId}`,
      type: "community.comment.reacted",
      payload: { commentId, postId: comment.postId, userId, reaction: "like", active: liked },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(communityCommentLikes)
      .where(eq(communityCommentLikes.commentId, commentId));
    return { liked, likeCount: countRows[0]?.count ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Enrichment helpers
// ---------------------------------------------------------------------------

async function loadAuthor(ctx: ServiceContext, userId: string): Promise<PostAuthor> {
  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  return { userId, name: user?.name ?? "Member", image: user?.image ?? null };
}

async function postImagesFor(
  ctx: ServiceContext,
  postIds: string[],
): Promise<Map<string, PostImageView[]>> {
  const map = new Map<string, PostImageView[]>();
  if (postIds.length === 0) return map;
  const rows = await ctx.db
    .select({
      id: communityPostImages.id,
      postId: communityPostImages.postId,
      mime: communityPostImages.mime,
    })
    .from(communityPostImages)
    .where(inArray(communityPostImages.postId, postIds))
    .orderBy(communityPostImages.position);
  for (const r of rows) {
    const list = map.get(r.postId) ?? [];
    list.push({ id: r.id, mime: r.mime });
    map.set(r.postId, list);
  }
  return map;
}

async function postLikeCounts(
  ctx: ServiceContext,
  postIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (postIds.length === 0) return map;
  const rows = await ctx.db
    .select({ postId: communityPostLikes.postId, count: sql<number>`count(*)::int` })
    .from(communityPostLikes)
    .where(inArray(communityPostLikes.postId, postIds))
    .groupBy(communityPostLikes.postId);
  for (const r of rows) map.set(r.postId, r.count);
  return map;
}

async function postCommentCounts(
  ctx: ServiceContext,
  postIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (postIds.length === 0) return map;
  const rows = await ctx.db
    .select({ postId: communityComments.postId, count: sql<number>`count(*)::int` })
    .from(communityComments)
    .where(and(inArray(communityComments.postId, postIds), eq(communityComments.status, "visible")))
    .groupBy(communityComments.postId);
  for (const r of rows) map.set(r.postId, r.count);
  return map;
}

async function myPostLikes(
  ctx: ServiceContext,
  postIds: string[],
  userId: string,
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const rows = await ctx.db
    .select({ postId: communityPostLikes.postId })
    .from(communityPostLikes)
    .where(and(inArray(communityPostLikes.postId, postIds), eq(communityPostLikes.userId, userId)));
  return new Set(rows.map((r) => r.postId));
}

async function commentLikeCountsFor(
  ctx: ServiceContext,
  commentIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (commentIds.length === 0) return map;
  const rows = await ctx.db
    .select({ commentId: communityCommentLikes.commentId, count: sql<number>`count(*)::int` })
    .from(communityCommentLikes)
    .where(inArray(communityCommentLikes.commentId, commentIds))
    .groupBy(communityCommentLikes.commentId);
  for (const r of rows) map.set(r.commentId, r.count);
  return map;
}

async function myCommentLikes(
  ctx: ServiceContext,
  commentIds: string[],
  userId: string,
): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const rows = await ctx.db
    .select({ commentId: communityCommentLikes.commentId })
    .from(communityCommentLikes)
    .where(
      and(
        inArray(communityCommentLikes.commentId, commentIds),
        eq(communityCommentLikes.userId, userId),
      ),
    );
  return new Set(rows.map((r) => r.commentId));
}
