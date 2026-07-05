CREATE TYPE "public"."rfq_channel_status" AS ENUM('pending', 'sent', 'responded', 'failed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."rfq_status" AS ENUM('draft', 'published', 'quoting', 'awarded', 'cancelled');--> statement-breakpoint
CREATE TABLE "rfq_channels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"contractor_id" uuid,
	"status" "rfq_channel_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"title" text NOT NULL,
	"spec_md" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"suburb" text NOT NULL,
	"building_type" text,
	"quotes_due_on" date,
	"status" "rfq_status" DEFAULT 'draft' NOT NULL,
	"awarded_quote_id" uuid,
	"decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "rfq_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "licence_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "insurance_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "platform_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "referral_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "fee_recipient" text;--> statement-breakpoint
ALTER TABLE "rfq_channels" ADD CONSTRAINT "rfq_channels_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_channels" ADD CONSTRAINT "rfq_channels_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_channels" ADD CONSTRAINT "rfq_channels_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rfq_channels_rfq_idx" ON "rfq_channels" USING btree ("rfq_id");--> statement-breakpoint
CREATE INDEX "rfqs_scheme_status_idx" ON "rfqs" USING btree ("scheme_id","status");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_channel_id_rfq_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."rfq_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_rfq_idx" ON "quotes" USING btree ("rfq_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_fee_disclosure" CHECK ((platform_fee_cents = 0 AND referral_fee_cents = 0) OR fee_recipient IS NOT NULL);