CREATE TYPE "public"."lot_type" AS ENUM('residential', 'commercial', 'carpark', 'storage');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'committee_member', 'chair', 'secretary', 'treasurer', 'tenant', 'contractor', 'manager_admin');--> statement-breakpoint
CREATE TYPE "public"."ownership_kind" AS ENUM('sole', 'joint', 'company_nominee');--> statement-breakpoint
CREATE TYPE "public"."scheme_status" AS ENUM('onboarding', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."document_access_level" AS ENUM('owners', 'committee', 'admin');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('plan_of_subdivision', 'rules', 'insurance', 'financial', 'minutes', 'contract', 'correspondence', 'certificate', 'levy_notice', 'other');--> statement-breakpoint
CREATE TYPE "public"."contractor_status" AS ENUM('pending', 'approved', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('public_liability', 'workcover', 'licence');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('open', 'triaged', 'quoting', 'approved', 'in_progress', 'completed', 'rejected', 'closed');--> statement-breakpoint
CREATE TYPE "public"."maintenance_urgency" AS ENUM('emergency', 'high', 'routine');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('requested', 'received', 'selected', 'declined');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('draft', 'dispatched', 'accepted', 'scheduled', 'in_progress', 'completed', 'verified', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bank_account_kind" AS ENUM('virtual_collection', 'operating');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('draft', 'committee_review', 'adopted', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."fund_kind" AS ENUM('admin', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('received', 'matched', 'pending_approval', 'approved', 'scheduled', 'paid', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_kind" AS ENUM('levy_charge', 'interest', 'payment', 'adjustment', 'certificate_fee');--> statement-breakpoint
CREATE TYPE "public"."levy_frequency" AS ENUM('quarterly', 'half_yearly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."levy_notice_status" AS ENUM('draft', 'issued', 'paid', 'partially_paid', 'overdue', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('received', 'matched', 'unmatched', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('queued', 'sent', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."attendance_mode" AS ENUM('in_person', 'online', 'proxy');--> statement-breakpoint
CREATE TYPE "public"."meeting_kind" AS ENUM('agm', 'sgm', 'committee');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('draft', 'notice_sent', 'in_progress', 'closed', 'minutes_distributed');--> statement-breakpoint
CREATE TYPE "public"."motion_status" AS ENUM('draft', 'open', 'carried', 'lost', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."proxy_scope" AS ENUM('meeting', 'standing');--> statement-breakpoint
CREATE TYPE "public"."resolution_type" AS ENUM('ordinary', 'special', 'unanimous');--> statement-breakpoint
CREATE TYPE "public"."vote_choice" AS ENUM('for', 'against', 'abstain');--> statement-breakpoint
CREATE TYPE "public"."insurance_policy_kind" AS ENUM('building', 'public_liability', 'office_bearers', 'fidelity', 'machinery', 'voluntary_workers');--> statement-breakpoint
CREATE TYPE "public"."compliance_kind" AS ENUM('agm_due', 'insurance_renewal', 'esm_inspection', 'financial_statements', 'bas', 'valuation', 'custom');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('upcoming', 'due', 'overdue', 'done', 'waived');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms', 'in_app', 'post');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_name" AS ENUM('echo', 'finance', 'maintenance', 'communications', 'compliance', 'documents', 'meetings');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed', 'awaiting_decision');--> statement-breakpoint
CREATE TYPE "public"."decider_role" AS ENUM('treasurer', 'committee', 'all_owners');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('budget_adoption', 'invoice_approval', 'quote_approval', 'debt_recovery', 'payment_plan', 'breach_notice', 'contractor_pool_change', 'emergency_review', 'other');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('pending', 'approved', 'declined', 'expired', 'escalated');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'owner' NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"unit_number" text,
	"lot_type" "lot_type" DEFAULT 'residential' NOT NULL,
	"entitlement" integer NOT NULL,
	"liability" integer NOT NULL,
	"street_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"elected_at_meeting_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"abn" text,
	"contact_email" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownerships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "ownership_kind" DEFAULT 'sole' NOT NULL,
	"share_numerator" integer DEFAULT 1 NOT NULL,
	"share_denominator" integer DEFAULT 1 NOT NULL,
	"is_levy_recipient" boolean DEFAULT true NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"user_id" text,
	"given_name" text,
	"family_name" text,
	"company_name" text,
	"email" text,
	"phone" text,
	"mailing_address" jsonb,
	"comms_prefs" jsonb DEFAULT '{"levy":"email","notices":"email"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schemes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"plan_of_subdivision" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"suburb" text NOT NULL,
	"state" text DEFAULT 'VIC' NOT NULL,
	"postcode" text NOT NULL,
	"tier" integer NOT NULL,
	"abn" text,
	"gst_registered" boolean DEFAULT false NOT NULL,
	"financial_year_end_month" integer DEFAULT 6 NOT NULL,
	"status" "scheme_status" DEFAULT 'onboarding' NOT NULL,
	"settings" jsonb DEFAULT '{"timezone":"Australia/Melbourne","maintenanceAutoApproveCents":50000,"maintenanceMultiQuoteCents":200000,"penaltyInterestBps":1000,"interestGraceDays":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"category" "document_category" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"access_level" "document_access_level" DEFAULT 'owners' NOT NULL,
	"retention_until" date,
	"supersedes_document_id" uuid,
	"uploaded_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"reference" text,
	"expires_on" date NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid,
	"organization_id" uuid,
	"business_name" text NOT NULL,
	"abn" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"trade_categories" text[] DEFAULT '{}' NOT NULL,
	"payout_ref" text,
	"status" "contractor_status" DEFAULT 'pending' NOT NULL,
	"rating_basis_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"location" text,
	"installed_on" date,
	"warranty_until" date,
	"expected_life_years" bigint,
	"replacement_cost_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"contractor_id" uuid,
	"rrule" text NOT NULL,
	"next_due_on" date NOT NULL,
	"is_esm" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid,
	"reported_by_person_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"urgency" "maintenance_urgency",
	"is_common_property" boolean,
	"ai_triage" jsonb,
	"photo_document_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" "maintenance_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"valid_until" date,
	"document_id" uuid,
	"status" "quote_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"request_id" uuid,
	"contractor_id" uuid NOT NULL,
	"quote_id" uuid,
	"scope" text NOT NULL,
	"approved_amount_cents" bigint NOT NULL,
	"access_notes" text,
	"status" "work_order_status" DEFAULT 'draft' NOT NULL,
	"decision_id" uuid,
	"scheduled_for" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completion_photo_document_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "bank_account_kind" NOT NULL,
	"provider" text NOT NULL,
	"provider_account_ref" text,
	"payid" text,
	"bsb" text,
	"account_number_masked" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"fund_kind" "fund_kind" NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"fiscal_year_start" date NOT NULL,
	"status" "budget_status" DEFAULT 'draft' NOT NULL,
	"adopted_at_meeting_id" uuid,
	"decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" text NOT NULL,
	"reference" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "fund_kind" NOT NULL,
	"name" text NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"contractor_id" uuid,
	"supplier_name" text NOT NULL,
	"abn" text,
	"invoice_number" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"gst_cents" bigint DEFAULT 0 NOT NULL,
	"due_on" date,
	"status" "invoice_status" DEFAULT 'received' NOT NULL,
	"work_order_id" uuid,
	"document_id" uuid,
	"decision_id" uuid,
	"fund_kind" "fund_kind" DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levy_notice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"levy_notice_id" uuid NOT NULL,
	"fund_kind" "fund_kind" NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levy_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"levy_schedule_id" uuid NOT NULL,
	"instalment" integer NOT NULL,
	"notice_number" text NOT NULL,
	"issued_at" timestamp with time zone,
	"due_on" date NOT NULL,
	"total_cents" bigint NOT NULL,
	"status" "levy_notice_status" DEFAULT 'draft' NOT NULL,
	"payid" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levy_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"frequency" "levy_frequency" DEFAULT 'quarterly' NOT NULL,
	"instalments" integer DEFAULT 4 NOT NULL,
	"first_due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"kind" "ledger_entry_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"levy_notice_id" uuid,
	"payment_id" uuid,
	"note" text,
	"effective_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"levy_notice_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"decision_id" uuid,
	"instalment_cents" bigint NOT NULL,
	"frequency" "levy_frequency" NOT NULL,
	"starts_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"payid" text,
	"amount_cents" bigint NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"payer_name" text,
	"status" "payment_status" DEFAULT 'received' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount_cents" bigint NOT NULL,
	"status" "payout_status" DEFAULT 'queued' NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"document_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"submitted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"lot_id" uuid,
	"mode" "attendance_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "meeting_kind" NOT NULL,
	"title" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" text,
	"video_url" text,
	"status" "meeting_status" DEFAULT 'draft' NOT NULL,
	"notice_sent_at" timestamp with time zone,
	"quorum_met" boolean,
	"minutes_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "motions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"meeting_id" uuid,
	"agenda_item_id" uuid,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"resolution_type" "resolution_type" DEFAULT 'ordinary' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"status" "motion_status" DEFAULT 'draft' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"grantor_person_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"proxy_person_id" uuid NOT NULL,
	"scope" "proxy_scope" DEFAULT 'meeting' NOT NULL,
	"meeting_id" uuid,
	"expires_on" date,
	"document_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"motion_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"cast_by_person_id" uuid NOT NULL,
	"via_proxy_id" uuid,
	"choice" "vote_choice" NOT NULL,
	"entitlement_weight" integer NOT NULL,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"description" text NOT NULL,
	"lodged_at" timestamp with time zone,
	"claim_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "insurance_policy_kind" NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text NOT NULL,
	"sum_insured_cents" bigint,
	"excess_cents" bigint,
	"premium_cents" bigint,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"certificate_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_obligations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "compliance_kind" NOT NULL,
	"title" text NOT NULL,
	"due_on" date NOT NULL,
	"rrule" text,
	"status" "compliance_status" DEFAULT 'upcoming' NOT NULL,
	"source_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"direction" "message_direction" DEFAULT 'outbound' NOT NULL,
	"person_id" uuid,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"template" text,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"related" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid,
	"agent" "agent_name" NOT NULL,
	"trigger_event_id" uuid NOT NULL,
	"model" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"input" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"causation_depth" integer DEFAULT 0 NOT NULL,
	"retry_of" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"kind" "decision_kind" NOT NULL,
	"title" text NOT NULL,
	"summary_md" text NOT NULL,
	"options" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" jsonb,
	"decider_role" "decider_role" NOT NULL,
	"default_option_id" text,
	"due_at" timestamp with time zone,
	"follow_up" jsonb,
	"status" "decision_status" DEFAULT 'pending' NOT NULL,
	"requested_by_run_id" uuid,
	"decided_by_user_id" text,
	"resolution" jsonb,
	"decision_note" text,
	"resolved_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_cursors" (
	"consumer" text PRIMARY KEY NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "event_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scheme_id" uuid,
	"stream" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"causation_depth" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownerships" ADD CONSTRAINT "ownerships_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownerships" ADD CONSTRAINT "ownerships_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownerships" ADD CONSTRAINT "ownerships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_credentials" ADD CONSTRAINT "contractor_credentials_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_credentials" ADD CONSTRAINT "contractor_credentials_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reported_by_person_id_people_id_fk" FOREIGN KEY ("reported_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_transactions" ADD CONSTRAINT "fund_transactions_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_transactions" ADD CONSTRAINT "fund_transactions_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_notice_lines" ADD CONSTRAINT "levy_notice_lines_levy_notice_id_levy_notices_id_fk" FOREIGN KEY ("levy_notice_id") REFERENCES "public"."levy_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_notices" ADD CONSTRAINT "levy_notices_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_notices" ADD CONSTRAINT "levy_notices_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_notices" ADD CONSTRAINT "levy_notices_levy_schedule_id_levy_schedules_id_fk" FOREIGN KEY ("levy_schedule_id") REFERENCES "public"."levy_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_notices" ADD CONSTRAINT "levy_notices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_schedules" ADD CONSTRAINT "levy_schedules_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_ledger_entries" ADD CONSTRAINT "lot_ledger_entries_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_ledger_entries" ADD CONSTRAINT "lot_ledger_entries_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_ledger_entries" ADD CONSTRAINT "lot_ledger_entries_levy_notice_id_levy_notices_id_fk" FOREIGN KEY ("levy_notice_id") REFERENCES "public"."levy_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_levy_notice_id_levy_notices_id_fk" FOREIGN KEY ("levy_notice_id") REFERENCES "public"."levy_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_submitted_by_person_id_people_id_fk" FOREIGN KEY ("submitted_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_minutes_document_id_documents_id_fk" FOREIGN KEY ("minutes_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motions" ADD CONSTRAINT "motions_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motions" ADD CONSTRAINT "motions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motions" ADD CONSTRAINT "motions_agenda_item_id_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_grantor_person_id_people_id_fk" FOREIGN KEY ("grantor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_proxy_person_id_people_id_fk" FOREIGN KEY ("proxy_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_motion_id_motions_id_fk" FOREIGN KEY ("motion_id") REFERENCES "public"."motions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_cast_by_person_id_people_id_fk" FOREIGN KEY ("cast_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_certificate_document_id_documents_id_fk" FOREIGN KEY ("certificate_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_scheme_idx" ON "invites" USING btree ("scheme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_scheme_lot_number_idx" ON "lots" USING btree ("scheme_id","lot_number");--> statement-breakpoint
CREATE INDEX "memberships_scheme_user_idx" ON "memberships" USING btree ("scheme_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ownerships_lot_idx" ON "ownerships" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ownerships_person_idx" ON "ownerships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "people_scheme_idx" ON "people" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "people_user_idx" ON "people" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schemes_plan_idx" ON "schemes" USING btree ("plan_of_subdivision");--> statement-breakpoint
CREATE INDEX "tenancies_lot_idx" ON "tenancies" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "documents_scheme_category_idx" ON "documents" USING btree ("scheme_id","category");--> statement-breakpoint
CREATE INDEX "contractor_credentials_contractor_idx" ON "contractor_credentials" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "contractors_scheme_idx" ON "contractors" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "assets_scheme_idx" ON "assets" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "maintenance_plans_scheme_idx" ON "maintenance_plans" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_scheme_status_idx" ON "maintenance_requests" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "quotes_request_idx" ON "quotes" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "work_orders_scheme_status_idx" ON "work_orders" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "bank_accounts_scheme_idx" ON "bank_accounts" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "budget_lines_budget_idx" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budgets_scheme_idx" ON "budgets" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "fund_transactions_fund_idx" ON "fund_transactions" USING btree ("fund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funds_scheme_kind_idx" ON "funds" USING btree ("scheme_id","kind");--> statement-breakpoint
CREATE INDEX "invoices_scheme_status_idx" ON "invoices" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "levy_notice_lines_notice_idx" ON "levy_notice_lines" USING btree ("levy_notice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "levy_notices_number_idx" ON "levy_notices" USING btree ("scheme_id","notice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "levy_notices_schedule_lot_instalment_idx" ON "levy_notices" USING btree ("levy_schedule_id","lot_id","instalment");--> statement-breakpoint
CREATE INDEX "levy_notices_lot_idx" ON "levy_notices" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "levy_schedules_scheme_idx" ON "levy_schedules" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "lot_ledger_lot_idx" ON "lot_ledger_entries" USING btree ("lot_id","effective_on");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_plans_lot_idx" ON "payment_plans" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_idx" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payments_scheme_status_idx" ON "payments" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE INDEX "payouts_invoice_idx" ON "payouts" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_number_idx" ON "receipts" USING btree ("scheme_id","receipt_number");--> statement-breakpoint
CREATE INDEX "agenda_items_meeting_idx" ON "agenda_items" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_attendance_idx" ON "meeting_attendance" USING btree ("meeting_id","person_id");--> statement-breakpoint
CREATE INDEX "meetings_scheme_idx" ON "meetings" USING btree ("scheme_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "motions_scheme_idx" ON "motions" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "proxies_scheme_idx" ON "proxies" USING btree ("scheme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_motion_lot_idx" ON "votes" USING btree ("motion_id","lot_id");--> statement-breakpoint
CREATE INDEX "insurance_claims_scheme_idx" ON "insurance_claims" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "insurance_policies_scheme_idx" ON "insurance_policies" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "compliance_obligations_scheme_due_idx" ON "compliance_obligations" USING btree ("scheme_id","due_on");--> statement-breakpoint
CREATE INDEX "announcements_scheme_idx" ON "announcements" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "messages_scheme_idx" ON "messages" USING btree ("scheme_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_trigger_idx" ON "agent_runs" USING btree ("trigger_event_id","agent","retry_of");--> statement-breakpoint
CREATE INDEX "agent_runs_scheme_idx" ON "agent_runs" USING btree ("scheme_id","started_at");--> statement-breakpoint
CREATE INDEX "decisions_scheme_status_idx" ON "decisions" USING btree ("scheme_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "event_log_seq_idx" ON "event_log" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "event_log_dedupe_idx" ON "event_log" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "event_log_scheme_idx" ON "event_log" USING btree ("scheme_id","seq");--> statement-breakpoint
CREATE INDEX "event_log_type_idx" ON "event_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "event_log_correlation_idx" ON "event_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_idx" ON "webhook_events" USING btree ("provider","provider_event_id");