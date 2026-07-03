import { COMMUNITY_POST_STATUSES } from "@goodstrata/shared";
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { users } from "./auth.js";
import { schemes } from "./tenancy.js";

export const communityPostStatusEnum = pgEnum("community_post_status", COMMUNITY_POST_STATUSES);

/**
 * A Facebook-group-style post on a scheme's community board. Author is a login
 * identity (users), not a contact record — posting is keyed to membership, and
 * the feed joins users for the author's name + avatar.
 */
export const communityPosts = pgTable(
  "community_posts",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    authorUserId: text()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    status: communityPostStatusEnum().notNull().default("visible"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("community_posts_scheme_idx").on(t.schemeId, t.createdAt)],
);

/** One image attached to a post (a mini-documents; stored via StorageProvider). */
export const communityPostImages = pgTable(
  "community_post_images",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    postId: uuid()
      .notNull()
      .references(() => communityPosts.id),
    storageKey: text().notNull(),
    mime: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("community_post_images_post_idx").on(t.postId)],
);

export const communityComments = pgTable(
  "community_comments",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    postId: uuid()
      .notNull()
      .references(() => communityPosts.id),
    authorUserId: text()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    status: communityPostStatusEnum().notNull().default("visible"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("community_comments_post_idx").on(t.postId, t.createdAt)],
);

/** One like per user per post — uniqueness enforced in the index. */
export const communityPostLikes = pgTable(
  "community_post_likes",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    postId: uuid()
      .notNull()
      .references(() => communityPosts.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("community_post_likes_post_user_idx").on(t.postId, t.userId)],
);

/** One like per user per comment. */
export const communityCommentLikes = pgTable(
  "community_comment_likes",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    commentId: uuid()
      .notNull()
      .references(() => communityComments.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("community_comment_likes_comment_user_idx").on(t.commentId, t.userId)],
);
