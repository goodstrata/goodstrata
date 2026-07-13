CREATE TYPE "public"."record_retention_class" AS ENUM('operational', 'minimum_12_months', 'statutory_7_years', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."insurance_claim_status" AS ENUM('draft', 'lodged', 'assessing', 'settled', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."insurance_policy_status" AS ENUM('draft', 'current', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."capital_item_condition" AS ENUM('good', 'fair', 'poor', 'critical', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."statutory_maintenance_plan_status" AS ENUM('draft', 'approved', 'review_due', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."manager_appointment_status" AS ENUM('draft', 'active', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."manager_registration_status" AS ENUM('current', 'suspended', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."certificate_request_status" AS ENUM('awaiting_payment', 'preparing', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."certificate_urgency" AS ENUM('standard_6_10_days', 'priority_3_5_days', 'urgent_2_days');--> statement-breakpoint
CREATE TYPE "public"."inspection_requester_type" AS ENUM('lot_owner', 'mortgagee', 'buyer', 'representative');--> statement-breakpoint
CREATE TYPE "public"."inspection_scope" AS ENUM('register', 'records', 'both');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('submitted', 'eligibility_verified', 'scheduled', 'completed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."register_item_kind" AS ENUM('rules_amendment', 'contract', 'lease', 'licence');--> statement-breakpoint
CREATE TYPE "public"."insurance_exemption" AS ENUM('two_lot_no_common_property', 'unanimous_no_common_property', 'vcat_order');--> statement-breakpoint
CREATE TYPE "public"."management_mode" AS ENUM('self_managed', 'volunteer_manager', 'registered_manager');--> statement-breakpoint
CREATE TABLE "final_fee_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"levy_notice_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"notice_number" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"recovery_eligible_on" date NOT NULL,
	"principal_cents" bigint NOT NULL,
	"interest_cents" bigint NOT NULL,
	"daily_interest_cents" bigint NOT NULL,
	"interest_rate_bps" integer NOT NULL,
	"document_id" uuid,
	"served_at" timestamp with time zone,
	"service_method" text,
	"service_recipient" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_statement_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"financial_statement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reviewer_name" text NOT NULL,
	"reviewer_organisation" text,
	"professional_body" text NOT NULL,
	"membership_number" text,
	"independent_declaration" text NOT NULL,
	"outcome" text NOT NULL,
	"report_document_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_statements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"accounting_basis" text DEFAULT 'special_purpose_accrual' NOT NULL,
	"figures" jsonb NOT NULL,
	"document_id" uuid,
	"presented_at_meeting_id" uuid,
	"prepared_at" timestamp with time zone NOT NULL,
	"presented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interest_authorisations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"motion_id" uuid NOT NULL,
	"rate_bps" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_valuations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"valuer_name" text NOT NULL,
	"valued_on" date NOT NULL,
	"replacement_value_cents" bigint NOT NULL,
	"next_due_on" date NOT NULL,
	"report_document_id" uuid,
	"presented_at_meeting_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"asset_id" uuid,
	"name" text NOT NULL,
	"present_condition" "capital_item_condition" DEFAULT 'unknown' NOT NULL,
	"planned_action" text NOT NULL,
	"scheduled_on" date NOT NULL,
	"estimated_cost_cents" bigint NOT NULL,
	"expected_life_after_works_years" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "statutory_maintenance_plan_status" DEFAULT 'draft' NOT NULL,
	"approved_form_version" text NOT NULL,
	"prepared_on" date NOT NULL,
	"coverage_start_on" date NOT NULL,
	"coverage_end_on" date NOT NULL,
	"maintenance_fund_id" uuid,
	"approval_resolution_id" uuid,
	"approved_on" date,
	"approved_at_meeting_id" uuid,
	"last_reviewed_on" date,
	"next_review_on" date,
	"source_document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "manager_appointment_status" DEFAULT 'draft' NOT NULL,
	"appointed_on" date NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"approved_form_name" text NOT NULL,
	"approved_form_version" text NOT NULL,
	"appointment_document_id" uuid NOT NULL,
	"appointment_resolution_id" uuid NOT NULL,
	"delegation_document_id" uuid NOT NULL,
	"delegation_resolution_id" uuid NOT NULL,
	"delegated_powers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terminated_on" date,
	"termination_resolution_id" uuid,
	"records_return_due_on" date,
	"change_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_registration_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"registration_number" text NOT NULL,
	"status" "manager_registration_status" NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"source_url" text,
	"evidence_document_id" uuid,
	"bla_notified_on" date,
	"bla_notification_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_election_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"elected_user_ids" jsonb NOT NULL,
	"expansion_motion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "powers_of_attorney" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"donor_person_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"attorney_person_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"document_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners_corporation_certificate_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"applicant_name" text NOT NULL,
	"applicant_email" text,
	"applicant_address" text,
	"urgency" "certificate_urgency" DEFAULT 'standard_6_10_days' NOT NULL,
	"additional_certificate" boolean DEFAULT false NOT NULL,
	"status" "certificate_request_status" DEFAULT 'awaiting_payment' NOT NULL,
	"written_request_received_at" timestamp with time zone NOT NULL,
	"fee_paid_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"quoted_fee_cents" bigint NOT NULL,
	"maximum_fee_cents" bigint NOT NULL,
	"attachment_document_ids" jsonb,
	"snapshot" jsonb,
	"certificate_document_id" uuid,
	"issued_at" timestamp with time zone,
	"issued_by" jsonb,
	"authorised_by_name" text,
	"authorised_by_title" text,
	"seal_applied_at" timestamp with time zone,
	"additional_fee_work_details" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners_corporation_register_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "register_item_kind" NOT NULL,
	"title" text NOT NULL,
	"details" text NOT NULL,
	"counterparty" text,
	"effective_on" date NOT NULL,
	"expires_on" date,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_inspection_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"requester_type" "inspection_requester_type" NOT NULL,
	"requester_name" text NOT NULL,
	"requester_email" text,
	"requester_address" text,
	"lot_id" uuid,
	"representative_of" text,
	"scope" "inspection_scope" NOT NULL,
	"requested_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wants_copies" boolean DEFAULT false NOT NULL,
	"commercial_purpose" boolean DEFAULT false NOT NULL,
	"commercial_consent_at" timestamp with time zone,
	"consent_evidence_document_id" uuid,
	"purpose" text,
	"status" "inspection_status" DEFAULT 'submitted' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"declined_reason" text,
	"copy_fee_cents" bigint,
	"maximum_copy_fee_cents" bigint,
	"handled_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "levy_schedules" ALTER COLUMN "budget_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_claims" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."insurance_claim_status";--> statement-breakpoint
ALTER TABLE "insurance_claims" ALTER COLUMN "status" SET DATA TYPE "public"."insurance_claim_status" USING "status"::"public"."insurance_claim_status";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retention_class" "record_retention_class" DEFAULT 'operational' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retention_basis" text;--> statement-breakpoint
UPDATE "documents"
SET
	"retention_class" = 'permanent'::"record_retention_class",
	"retention_basis" = 'Building-life record',
	"retention_until" = NULL
WHERE "category" = 'plan_of_subdivision';--> statement-breakpoint
UPDATE "documents"
SET
	"retention_class" = 'statutory_7_years'::"record_retention_class",
	"retention_basis" = CASE
		WHEN "category" = 'financial' THEN 'OC Act financial record — minimum seven years'
		ELSE 'OC Act owners corporation record — minimum seven years'
	END,
	"retention_until" = CASE
		WHEN "retention_until" IS NULL
			OR "retention_until" < (("created_at" AT TIME ZONE 'UTC') + INTERVAL '7 years')::date
		THEN (("created_at" AT TIME ZONE 'UTC') + INTERVAL '7 years')::date
		ELSE "retention_until"
	END
WHERE "category" NOT IN ('other', 'plan_of_subdivision');--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "adopted_by_motion_id" uuid;--> statement-breakpoint
ALTER TABLE "levy_notices" ADD COLUMN "interest_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "levy_notices" ADD COLUMN "interest_motion_id" uuid;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD COLUMN "fee_kind" text DEFAULT 'annual' NOT NULL;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD COLUMN "resolution_motion_id" uuid;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD COLUMN "special_fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD COLUMN "special_fund_kind" "fund_kind";--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD COLUMN "special_allocations" jsonb;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD COLUMN "incident_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD COLUMN "amount_claimed_cents" bigint;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD COLUMN "amount_settled_cents" bigint;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD COLUMN "settlement_document_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "status" "insurance_policy_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "reinstatement_and_replacement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "exemption_document_id" uuid;--> statement-breakpoint
ALTER TABLE "manager_pi_policies" ADD COLUMN "bla_notified_on" date;--> statement-breakpoint
ALTER TABLE "manager_pi_policies" ADD COLUMN "bla_notification_reference" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chair_person_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chair_name" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chair_appointed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chair_assisted_by_ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proxies" ADD COLUMN "retention_until" date;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "via_power_of_attorney_id" uuid;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "retention_until" date;--> statement-breakpoint
UPDATE "votes"
SET "retention_until" = (("cast_at" AT TIME ZONE 'UTC') + INTERVAL '12 months')::date
WHERE "retention_until" IS NULL;--> statement-breakpoint
UPDATE "proxies"
SET "retention_until" = (
	COALESCE(
		"expires_on",
		(("created_at" AT TIME ZONE 'UTC') + INTERVAL '12 months')::date
	) + INTERVAL '12 months'
)::date
WHERE "retention_until" IS NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "lot_liability_basis" text;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "lot_entitlement_basis" text;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "management_mode" "management_mode" DEFAULT 'self_managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "manager_opt_out_resolution_id" uuid;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "is_retirement_village" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "has_common_property" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "is_multi_storey" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "insurance_exemption" "insurance_exemption";--> statement-breakpoint
ALTER TABLE "final_fee_notices" ADD CONSTRAINT "final_fee_notices_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_fee_notices" ADD CONSTRAINT "final_fee_notices_levy_notice_id_levy_notices_id_fk" FOREIGN KEY ("levy_notice_id") REFERENCES "public"."levy_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_fee_notices" ADD CONSTRAINT "final_fee_notices_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_fee_notices" ADD CONSTRAINT "final_fee_notices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statement_reviews" ADD CONSTRAINT "financial_statement_reviews_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statement_reviews" ADD CONSTRAINT "financial_statement_reviews_financial_statement_id_financial_statements_id_fk" FOREIGN KEY ("financial_statement_id") REFERENCES "public"."financial_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statement_reviews" ADD CONSTRAINT "financial_statement_reviews_report_document_id_documents_id_fk" FOREIGN KEY ("report_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_authorisations" ADD CONSTRAINT "interest_authorisations_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_valuations" ADD CONSTRAINT "insurance_valuations_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_valuations" ADD CONSTRAINT "insurance_valuations_report_document_id_documents_id_fk" FOREIGN KEY ("report_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_items" ADD CONSTRAINT "maintenance_plan_items_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_items" ADD CONSTRAINT "maintenance_plan_items_plan_id_statutory_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."statutory_maintenance_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_items" ADD CONSTRAINT "maintenance_plan_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_items" ADD CONSTRAINT "maintenance_plan_items_completion_work_order_id_work_orders_id_fk" FOREIGN KEY ("completion_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_maintenance_plans" ADD CONSTRAINT "statutory_maintenance_plans_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_maintenance_plans" ADD CONSTRAINT "statutory_maintenance_plans_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_appointments" ADD CONSTRAINT "manager_appointments_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_appointments" ADD CONSTRAINT "manager_appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_appointments" ADD CONSTRAINT "manager_appointments_appointment_document_id_documents_id_fk" FOREIGN KEY ("appointment_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_appointments" ADD CONSTRAINT "manager_appointments_delegation_document_id_documents_id_fk" FOREIGN KEY ("delegation_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_registration_checks" ADD CONSTRAINT "manager_registration_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_registration_checks" ADD CONSTRAINT "manager_registration_checks_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_election_records" ADD CONSTRAINT "committee_election_records_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_election_records" ADD CONSTRAINT "committee_election_records_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_election_records" ADD CONSTRAINT "committee_election_records_expansion_motion_id_motions_id_fk" FOREIGN KEY ("expansion_motion_id") REFERENCES "public"."motions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_donor_person_id_people_id_fk" FOREIGN KEY ("donor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_attorney_person_id_people_id_fk" FOREIGN KEY ("attorney_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners_corporation_certificate_requests" ADD CONSTRAINT "owners_corporation_certificate_requests_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners_corporation_certificate_requests" ADD CONSTRAINT "owners_corporation_certificate_requests_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners_corporation_certificate_requests" ADD CONSTRAINT "owners_corporation_certificate_requests_certificate_document_id_documents_id_fk" FOREIGN KEY ("certificate_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners_corporation_register_items" ADD CONSTRAINT "owners_corporation_register_items_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owners_corporation_register_items" ADD CONSTRAINT "owners_corporation_register_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_inspection_requests" ADD CONSTRAINT "record_inspection_requests_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_inspection_requests" ADD CONSTRAINT "record_inspection_requests_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_inspection_requests" ADD CONSTRAINT "record_inspection_requests_consent_evidence_document_id_documents_id_fk" FOREIGN KEY ("consent_evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "final_fee_notices_levy_idx" ON "final_fee_notices" USING btree ("levy_notice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "final_fee_notices_number_idx" ON "final_fee_notices" USING btree ("scheme_id","notice_number");--> statement-breakpoint
CREATE INDEX "final_fee_notices_lot_idx" ON "final_fee_notices" USING btree ("scheme_id","lot_id");--> statement-breakpoint
CREATE INDEX "financial_statement_reviews_statement_idx" ON "financial_statement_reviews" USING btree ("financial_statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_statements_period_idx" ON "financial_statements" USING btree ("scheme_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "interest_authorisations_motion_idx" ON "interest_authorisations" USING btree ("motion_id");--> statement-breakpoint
CREATE INDEX "interest_authorisations_scheme_idx" ON "interest_authorisations" USING btree ("scheme_id","effective_from");--> statement-breakpoint
CREATE INDEX "insurance_valuations_scheme_idx" ON "insurance_valuations" USING btree ("scheme_id","valued_on");--> statement-breakpoint
CREATE INDEX "maintenance_plan_items_plan_idx" ON "maintenance_plan_items" USING btree ("plan_id","scheduled_on");--> statement-breakpoint
CREATE INDEX "statutory_maintenance_plans_scheme_idx" ON "statutory_maintenance_plans" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "manager_appointments_scheme_idx" ON "manager_appointments" USING btree ("scheme_id","status","ends_on");--> statement-breakpoint
CREATE INDEX "manager_registration_checks_org_idx" ON "manager_registration_checks" USING btree ("organization_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "committee_election_meeting_idx" ON "committee_election_records" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "powers_of_attorney_scheme_idx" ON "powers_of_attorney" USING btree ("scheme_id","attorney_person_id");--> statement-breakpoint
CREATE INDEX "oc_certificate_requests_scheme_status_idx" ON "owners_corporation_certificate_requests" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "oc_register_items_scheme_idx" ON "owners_corporation_register_items" USING btree ("scheme_id","kind");--> statement-breakpoint
CREATE INDEX "record_inspections_scheme_status_idx" ON "record_inspection_requests" USING btree ("scheme_id","status");--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_settlement_document_id_documents_id_fk" FOREIGN KEY ("settlement_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_exemption_document_id_documents_id_fk" FOREIGN KEY ("exemption_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_chair_person_id_people_id_fk" FOREIGN KEY ("chair_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
