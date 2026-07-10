CREATE TYPE "public"."comment_entity_type" AS ENUM('maintenance_request', 'complaint');--> statement-breakpoint
CREATE TABLE "entity_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"entity_type" "comment_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "entity_comments" ADD CONSTRAINT "entity_comments_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_comments" ADD CONSTRAINT "entity_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_comments_entity_idx" ON "entity_comments" USING btree ("entity_type","entity_id","created_at");