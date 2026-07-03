CREATE TYPE "public"."breach_notice_status" AS ENUM('issued', 'rectified', 'escalated', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."breach_notice_type" AS ENUM('notice_to_rectify', 'final_notice');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('received', 'under_discussion', 'notice_to_rectify', 'final_notice', 'resolved', 'withdrawn', 'vcat');--> statement-breakpoint
CREATE TABLE "breach_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"complaint_id" uuid,
	"subject_lot_id" uuid,
	"subject_person_id" uuid,
	"rule_ref" text NOT NULL,
	"type" "breach_notice_type" NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rectify_by_date" date NOT NULL,
	"status" "breach_notice_status" DEFAULT 'issued' NOT NULL,
	"details" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaint_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"complaint_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor" jsonb NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"complainant_person_id" uuid NOT NULL,
	"respondent_person_id" uuid,
	"subject" text NOT NULL,
	"details" text NOT NULL,
	"approved_form" boolean DEFAULT false NOT NULL,
	"status" "complaint_status" DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meet_by_date" date NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "account_number" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "payid_root" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "motions" ADD COLUMN "poll_demanded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_subject_lot_id_lots_id_fk" FOREIGN KEY ("subject_lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notices" ADD CONSTRAINT "breach_notices_subject_person_id_people_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_complainant_person_id_people_id_fk" FOREIGN KEY ("complainant_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_respondent_person_id_people_id_fk" FOREIGN KEY ("respondent_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breach_notices_scheme_status_idx" ON "breach_notices" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "complaint_events_complaint_idx" ON "complaint_events" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "complaints_scheme_status_idx" ON "complaints" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_scheme_kind_idx" ON "bank_accounts" USING btree ("scheme_id","kind");