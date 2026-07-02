/**
 * Domain enums — single source of truth, mirrored into Drizzle pgEnums.
 * Victorian OC Act 2006 terminology; "scheme" is the jurisdiction-neutral
 * name for an owners corporation.
 */

export const SCHEME_STATUSES = ["onboarding", "active", "archived"] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

export const LOT_TYPES = ["residential", "commercial", "carpark", "storage"] as const;
export type LotType = (typeof LOT_TYPES)[number];

export const MEMBERSHIP_ROLES = [
  "owner",
  "committee_member",
  "chair",
  "secretary",
  "treasurer",
  "tenant",
  "contractor",
  "manager_admin",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Roles that sit on the committee (used for decision routing). */
export const COMMITTEE_ROLES: readonly MembershipRole[] = [
  "committee_member",
  "chair",
  "secretary",
  "treasurer",
];

export const OWNERSHIP_KINDS = ["sole", "joint", "company_nominee"] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

export const FUND_KINDS = ["admin", "maintenance"] as const;
export type FundKind = (typeof FUND_KINDS)[number];

export const BUDGET_STATUSES = ["draft", "committee_review", "adopted", "superseded"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const LEVY_FREQUENCIES = ["quarterly", "half_yearly", "annual"] as const;
export type LevyFrequency = (typeof LEVY_FREQUENCIES)[number];

export const LEVY_NOTICE_STATUSES = [
  "draft",
  "issued",
  "paid",
  "partially_paid",
  "overdue",
  "written_off",
] as const;
export type LevyNoticeStatus = (typeof LEVY_NOTICE_STATUSES)[number];

export const LEDGER_ENTRY_KINDS = [
  "levy_charge",
  "interest",
  "payment",
  "adjustment",
  "certificate_fee",
] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export const PAYMENT_STATUSES = ["received", "matched", "unmatched", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVOICE_STATUSES = [
  "received",
  "matched",
  "pending_approval",
  "approved",
  "scheduled",
  "paid",
  "disputed",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const MAINTENANCE_URGENCIES = ["emergency", "high", "routine"] as const;
export type MaintenanceUrgency = (typeof MAINTENANCE_URGENCIES)[number];

export const MAINTENANCE_STATUSES = [
  "open",
  "triaged",
  "quoting",
  "approved",
  "in_progress",
  "completed",
  "rejected",
  "closed",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const WORK_ORDER_STATUSES = [
  "draft",
  "dispatched",
  "accepted",
  "scheduled",
  "in_progress",
  "completed",
  "verified",
  "cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const MEETING_KINDS = ["agm", "sgm", "committee"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_STATUSES = [
  "draft",
  "notice_sent",
  "in_progress",
  "closed",
  "minutes_distributed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const RESOLUTION_TYPES = ["ordinary", "special", "unanimous"] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export const MOTION_STATUSES = ["draft", "open", "carried", "lost", "withdrawn"] as const;
export type MotionStatus = (typeof MOTION_STATUSES)[number];

export const VOTE_CHOICES = ["for", "against", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export const DOCUMENT_CATEGORIES = [
  "plan_of_subdivision",
  "rules",
  "insurance",
  "financial",
  "minutes",
  "contract",
  "correspondence",
  "certificate",
  "levy_notice",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_ACCESS_LEVELS = ["owners", "committee", "admin"] as const;
export type DocumentAccessLevel = (typeof DOCUMENT_ACCESS_LEVELS)[number];

export const COMPLIANCE_KINDS = [
  "agm_due",
  "insurance_renewal",
  "esm_inspection",
  "financial_statements",
  "bas",
  "valuation",
  "custom",
] as const;
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];

export const COMPLIANCE_STATUSES = ["upcoming", "due", "overdue", "done", "waived"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const MESSAGE_CHANNELS = ["email", "sms", "in_app", "post"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = ["queued", "sent", "delivered", "bounced", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const DECISION_KINDS = [
  "budget_adoption",
  "invoice_approval",
  "quote_approval",
  "debt_recovery",
  "payment_plan",
  "breach_notice",
  "contractor_pool_change",
  "emergency_review",
  "other",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_STATUSES = [
  "pending",
  "approved",
  "declined",
  "expired",
  "escalated",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Escalation ladder for unanswered decisions (SPEC §14 committee non-engagement). */
export const DECIDER_ROLES = ["treasurer", "committee", "all_owners"] as const;
export type DeciderRole = (typeof DECIDER_ROLES)[number];

export const AGENT_NAMES = [
  "echo",
  "finance",
  "maintenance",
  "communications",
  "compliance",
  "documents",
  "meetings",
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const AGENT_RUN_STATUSES = ["running", "succeeded", "failed", "awaiting_decision"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const CONTRACTOR_STATUSES = ["pending", "approved", "suspended"] as const;
export type ContractorStatus = (typeof CONTRACTOR_STATUSES)[number];

export const CREDENTIAL_KINDS = ["public_liability", "workcover", "licence"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** Tier per OC Act: derived from lot count. */
export function schemeTier(lotCount: number): 1 | 2 | 3 | 4 | 5 {
  if (lotCount > 100) return 1;
  if (lotCount > 50) return 2;
  if (lotCount > 10) return 3;
  if (lotCount >= 3) return 4;
  return 5;
}
