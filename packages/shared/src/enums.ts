/**
 * Domain enums — single source of truth, mirrored into Drizzle pgEnums.
 * Victorian OC Act 2006 terminology; "scheme" is the jurisdiction-neutral
 * name for an owners corporation.
 */

export const SCHEME_STATUSES = ["onboarding", "active", "archived"] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

export const LOT_TYPES = ["residential", "commercial", "carpark", "storage"] as const;
export type LotType = (typeof LOT_TYPES)[number];

/**
 * Occupiable lot types for CAV tier banding (OC Act / Owners Corporations
 * Regulations). Accessory lots — carparks and storage cages — are NOT occupiable
 * and must be excluded from the tier lot count. Feeding total lots (incl.
 * accessory) into schemeTier over-states the tier and imposes the wrong statutory
 * obligations on the OC.
 */
const OCCUPIABLE_LOT_TYPES: ReadonlySet<LotType> = new Set(["residential", "commercial"]);

/** True if the lot type counts toward the OC Act occupiable-lot tally. */
export function isOccupiableLot(lotType: LotType): boolean {
  return OCCUPIABLE_LOT_TYPES.has(lotType);
}

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

/**
 * Roles that may be granted through an invite. Excludes `manager_admin` — the
 * super-role that bypasses every `requireRole`/`ctx.actor` gate — so an officer
 * cannot use an invite (including a self-addressed one) to escalate a person to
 * full management control of the scheme. Invite call sites validate against this
 * list, and `invitePerson` re-checks it defensively before persisting.
 */
export const INVITABLE_ROLES = [
  "owner",
  "committee_member",
  "chair",
  "secretary",
  "treasurer",
  "tenant",
  "contractor",
] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

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

/** Per-OC bank account kinds (OC Act s 122 segregated trust accounts). */
export const BANK_ACCOUNT_KINDS = ["virtual_collection", "operating"] as const;
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number];

/** Provisioning/lifecycle state of a per-OC bank account. */
export const BANK_ACCOUNT_STATUSES = ["pending", "active", "closed"] as const;
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number];

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

/** Community board moderation status. "removed" is the soft-delete tombstone. */
export const COMMUNITY_POST_STATUSES = ["visible", "hidden", "removed"] as const;
export type CommunityPostStatus = (typeof COMMUNITY_POST_STATUSES)[number];

export const COMPLIANCE_KINDS = [
  "agm_due",
  "insurance_renewal",
  "esm_inspection",
  "financial_statements",
  "bas",
  "valuation",
  "custom",
  /** Manager's registration lapse (registered-manager path — s147/148 register). */
  "registration_renewal",
  /** Manager's professional-indemnity cover expiry (s119(5)/reg10 — ≥$2M held continuously). */
  "pi_expiry",
] as const;
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];

export const COMPLIANCE_STATUSES = ["upcoming", "due", "overdue", "done", "waived"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/**
 * Escalation band for an obligation as its due date approaches. The sweep
 * recomputes this from (dueOn − now); crossing into a new notifying band
 * (t_90/t_60/t_30/due/overdue) fires a `compliance.obligation.due` event.
 */
export const COMPLIANCE_ESCALATIONS = ["none", "t_90", "t_60", "t_30", "due", "overdue"] as const;
export type ComplianceEscalation = (typeof COMPLIANCE_ESCALATIONS)[number];

/** Bands that warrant a notification to the responsible role. */
export const COMPLIANCE_NOTIFYING_ESCALATIONS: readonly ComplianceEscalation[] = [
  "t_90",
  "t_60",
  "t_30",
  "due",
  "overdue",
];

/**
 * Grievance/dispute lifecycle (OC Act Part 10 — grievance procedure).
 * received → under_discussion → notice_to_rectify → final_notice → resolved
 * (or withdrawn / escalated to VCAT).
 */
export const COMPLAINT_STATUSES = [
  "received",
  "under_discussion",
  "notice_to_rectify",
  "final_notice",
  "resolved",
  "withdrawn",
  "vcat",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Breach-notice escalation stages. */
export const BREACH_NOTICE_TYPES = ["notice_to_rectify", "final_notice"] as const;
export type BreachNoticeType = (typeof BREACH_NOTICE_TYPES)[number];

export const BREACH_NOTICE_STATUSES = ["issued", "rectified", "escalated", "withdrawn"] as const;
export type BreachNoticeStatus = (typeof BREACH_NOTICE_STATUSES)[number];

/** Kinds of entry in a complaint's audit trail. */
export const COMPLAINT_EVENT_KINDS = [
  "filed",
  "acknowledged",
  "discussion",
  "notice_issued",
  "rectified",
  "resolved",
  "withdrawn",
  "escalated",
  "note",
] as const;
export type ComplaintEventKind = (typeof COMPLAINT_EVENT_KINDS)[number];

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
  "chair",
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

/** Kinds of note the AI chair writes to a meeting's chair log. */
export const CHAIR_NOTE_KINDS = ["guidance", "agenda", "action", "info"] as const;
export type ChairNoteKind = (typeof CHAIR_NOTE_KINDS)[number];

/** One entry in meetings.chair_log (append-only jsonb array). */
export interface ChairLogEntry {
  /** ISO timestamp. */
  at: string;
  kind: ChairNoteKind;
  note: string;
}

export const AGENT_RUN_STATUSES = ["running", "succeeded", "failed", "awaiting_decision"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const CONTRACTOR_STATUSES = ["pending", "approved", "suspended"] as const;
export type ContractorStatus = (typeof CONTRACTOR_STATUSES)[number];

export const CREDENTIAL_KINDS = ["public_liability", "workcover", "licence"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/**
 * CAV tier per OC Act, banded by the number of OCCUPIABLE lots:
 *   T1 >100, T2 51–100, T3 10–50, T4 3–9, T5 2-lot or services-only.
 * A services-only OC is always T5 regardless of lot count.
 */
export function schemeTier(occupiableLots: number, servicesOnly = false): 1 | 2 | 3 | 4 | 5 {
  if (servicesOnly) return 5;
  if (occupiableLots > 100) return 1;
  if (occupiableLots > 50) return 2;
  if (occupiableLots >= 10) return 3;
  if (occupiableLots >= 3) return 4;
  return 5;
}
