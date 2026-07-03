ALTER TYPE "public"."compliance_kind" ADD VALUE 'registration_renewal';--> statement-breakpoint
ALTER TYPE "public"."compliance_kind" ADD VALUE 'pi_expiry';--> statement-breakpoint
CREATE TABLE "manager_pi_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text NOT NULL,
	"cover_amount_cents" bigint NOT NULL,
	"effective_on" date,
	"expires_on" date NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_obligations" ALTER COLUMN "scheme_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "escalation_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "responsible_role" text;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "subject_ref" text;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "period_key" text;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD COLUMN "completed_by" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "manager_registration_number" text;--> statement-breakpoint
ALTER TABLE "manager_pi_policies" ADD CONSTRAINT "manager_pi_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_pi_policies" ADD CONSTRAINT "manager_pi_policies_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manager_pi_policies_org_idx" ON "manager_pi_policies" USING btree ("organization_id","expires_on");--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_obligations_org_due_idx" ON "compliance_obligations" USING btree ("organization_id","due_on");--> statement-breakpoint
CREATE INDEX "compliance_obligations_status_due_idx" ON "compliance_obligations" USING btree ("status","due_on");--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_dedupeKey_unique" UNIQUE("dedupe_key");