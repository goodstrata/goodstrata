/**
 * Notification deep-link resolver (web).
 *
 * Turns a notification row into the scheme section it is about, so tapping the
 * bell jumps to the record instead of leaving the reader to hunt for it. The
 * native app has the same table in src/lib/notificationTarget.ts — keep the two
 * in step; this one resolves to a `?section=` value (the web register index)
 * rather than an expo-router pathname.
 *
 * There is no event-type field on a notification row. Routing keys off the
 * `related.type` PREFIX (the token before the first "."), so both today's
 * single-token types (`decision`, `work_order`) and any future dotted types
 * (`document.uploaded`) resolve through one lookup. `related` can be null, so
 * we degrade: related.type → category → the scheme overview.
 */

/** A destination in the scheme register index (the `?section=` search param). */
export type NotificationSection =
  | "overview"
  | "finance"
  | "maintenance"
  | "meetings"
  | "decisions"
  | "grievances"
  | "compliance"
  | "documents"
  | "community"
  | "messages";

/** The subset of a notification row the resolver needs. */
export interface RoutableNotification {
  related?: { type: string; id: string } | null;
  /** Stored as text; unknown values fall through to the overview. */
  category?: string | null;
}

/** `related.type` prefix → section. Mirrors native's TYPE_SECTIONS. */
const TYPE_SECTIONS: Record<string, NotificationSection> = {
  // Decisions.
  decision: "decisions",
  vote: "decisions",
  // Meetings — motions, proxies and minutes are managed inside the meeting.
  meeting: "meetings",
  motion: "meetings",
  proxy: "meetings",
  minutes: "meetings",
  // Finance — levies, arrears, trust money.
  levy_notice: "finance",
  lot: "finance", // arrears.stage.reached; arrears lives in finance
  budget: "finance",
  payment: "finance",
  receipt: "finance",
  trust_account: "finance",
  invoice: "finance",
  payout: "finance",
  // Maintenance — the RFQ / work-order family.
  work_order: "maintenance",
  maintenance_request: "maintenance",
  quote: "maintenance",
  rfq: "maintenance",
  // Documents, community, compliance, grievances.
  document: "documents",
  community_post: "community",
  announcement: "community",
  // Private messages have their own section on web; native still routes these
  // to community until it grows a messages screen.
  conversation: "messages",
  compliance_obligation: "compliance",
  complaint: "grievances",
  breach_notice: "grievances",
};

/** `category` → section, used when `related` is null or its type is unknown. */
const CATEGORY_SECTIONS: Record<string, NotificationSection> = {
  finance: "finance",
  maintenance: "maintenance",
  meeting: "meetings",
  decision: "decisions",
  general: "overview",
};

/**
 * The section a notification points at. Falls back to the overview, which every
 * viewer can see — so a tap never dead-ends, even on an unknown type.
 */
export function sectionForNotification(n: RoutableNotification): NotificationSection {
  const prefix = n.related?.type.split(".")[0];
  const byType = prefix ? TYPE_SECTIONS[prefix] : undefined;
  return byType ?? (n.category ? CATEGORY_SECTIONS[n.category] : undefined) ?? "overview";
}
