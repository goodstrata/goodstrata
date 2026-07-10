CREATE TYPE "public"."community_post_visibility" AS ENUM('scheme', 'committee');--> statement-breakpoint
CREATE TYPE "public"."agenda_item_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "visibility" "community_post_visibility" DEFAULT 'scheme' NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD COLUMN "status" "agenda_item_status" DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD COLUMN "motion_text" text;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD COLUMN "rejected_reason" text;