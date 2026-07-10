import { COMMENT_ENTITY_TYPES } from "@goodstrata/shared";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { users } from "./auth.js";
import { schemes } from "./tenancy.js";

export const commentEntityTypeEnum = pgEnum("comment_entity_type", COMMENT_ENTITY_TYPES);

/**
 * Member-facing comment thread on a maintenance request or a grievance
 * complaint — the two-way discussion between the member who raised the matter
 * and the officers handling it (complaint respondents never see the thread).
 *
 * Polymorphic on (entityType, entityId), mirroring the notifications
 * `related {type, id}` taste: `entityId` is a soft reference (no FK) into the
 * table `entityType` names, so the thread can span domains without coupling
 * this table to each of them.
 *
 * Authorship follows communityComments: both sides of the conversation are
 * signed-in members, so the author is a login identity (users) — the read
 * model joins users for the name + avatar. ON DELETE SET NULL: the thread
 * survives account deletion; only the author link severs.
 */
export const entityComments = pgTable(
  "entity_comments",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    entityType: commentEntityTypeEnum().notNull(),
    /** Soft polymorphic reference into the table named by entityType. */
    entityId: uuid().notNull(),
    /** ON DELETE SET NULL: the comment survives account deletion; only the author link severs. */
    authorUserId: text().references(() => users.id, { onDelete: "set null" }),
    body: text().notNull(),
    createdAt: createdAt(),
    /** Soft delete (author retraction or officer moderation); null = visible. */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("entity_comments_entity_idx").on(t.entityType, t.entityId, t.createdAt)],
);
