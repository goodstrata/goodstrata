-- Deletion integrity: these userId → users.id links previously had no ON
-- DELETE action, so deleting a better-auth account with any scheme history
-- (a roll entry, a membership, a post, a vote, a notification) hit an FK
-- violation and could not complete. This migration severs rather than
-- cascades: the link is SET NULL on account deletion, and every row it was
-- attached to (roll entries, role-period history, posts/comments/likes,
-- decision ballots, notifications) survives with a null userId.
--
-- Tradeoff, called out per-column in schema/spine.ts: decisions.decidedByUserId
-- is the one link where the actor is historically load-bearing (who approved
-- this?) with no denormalised name to fall back on — SET NULL here means that
-- attribution is lost if the decider's account is later deleted, while the
-- resolution itself (option, note, resolvedAt) is unaffected.
ALTER TABLE "community_comment_likes" DROP CONSTRAINT "community_comment_likes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "community_comments" DROP CONSTRAINT "community_comments_author_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "community_post_likes" DROP CONSTRAINT "community_post_likes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "community_posts" DROP CONSTRAINT "community_posts_author_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "decision_votes" DROP CONSTRAINT "decision_votes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_decided_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "community_comment_likes" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_comments" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_post_likes" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_posts" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_votes" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_comment_likes" ADD CONSTRAINT "community_comment_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_likes" ADD CONSTRAINT "community_post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_votes" ADD CONSTRAINT "decision_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;