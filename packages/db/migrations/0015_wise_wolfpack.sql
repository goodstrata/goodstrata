CREATE TABLE "notification_delivery_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"lease_id" uuid NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_receipt_tickets" (
	"receipt_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_delivery_claims" ADD CONSTRAINT "notification_delivery_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_claims_event_user_channel_idx" ON "notification_delivery_claims" USING btree ("event_id","user_id","channel");--> statement-breakpoint
CREATE INDEX "notification_delivery_claims_user_idx" ON "notification_delivery_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_claims_lease_idx" ON "notification_delivery_claims" USING btree ("completed_at","lease_until");--> statement-breakpoint
CREATE INDEX "push_receipt_tickets_available_idx" ON "push_receipt_tickets" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "push_receipt_tickets_expires_idx" ON "push_receipt_tickets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "push_receipt_tickets_token_idx" ON "push_receipt_tickets" USING btree ("token");