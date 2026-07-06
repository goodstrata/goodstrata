/**
 * Notification deep-link resolver.
 *
 * A pure function that turns an in-app notification into an expo-router target
 * (`{ pathname, params }`) so tapping it can jump straight to the entity it is
 * about. It keys off the stored `related.type` (the deep-link anchor written by
 * the notifier), falling back to `category`, and finally to the scheme hub.
 *
 * There is NO event-type field on a notification row. The "families" in the
 * product brief (meeting.*, motion.*, budget.*, rfq.*, …) are the notifier's
 * event types and are NOT persisted — routing keys off `related.type` (+ id),
 * with `category` as the fallback. `related` can be null, so we always degrade
 * gracefully: related.type → category → scheme hub.
 *
 * Extensibility: routing is a single lookup keyed by the `related.type` PREFIX
 * (the token before the first "."), so both today's single-token types
 * (`decision`, `work_order`, …) and any future dotted event-style types
 * (`document.uploaded`) resolve through the same table. To wire a new screen in
 * later, add one line to TYPE_SECTIONS (or, for maintenance, flip
 * `maintenanceRouteExists` once /scheme/[id]/maintenance ships).
 */

/** The five notification categories persisted on a row (text enum). */
export type NotificationCategory =
  | "finance"
  | "maintenance"
  | "meeting"
  | "decision"
  | "general";

/** The deep-link anchor on a notification row: entity type + id, or null. */
export type NotificationRelated = { type: string; id: string } | null;

/** The subset of a notification the resolver needs. A FeedItem is assignable. */
export interface RoutableNotification {
  schemeId: string;
  related?: NotificationRelated;
  /** Stored as text; unknown values fall through to the scheme hub. */
  category?: NotificationCategory | (string & {}) | null;
}

/** An expo-router push target. `params` carries the entity id to highlight. */
export interface NotificationTarget {
  pathname: string;
  params?: { focus: string };
}

/**
 * Does the maintenance sub-route (`/scheme/[id]/maintenance`) exist on mobile
 * yet? It does NOT today, so maintenance notifications fall back to the scheme
 * hub. Flip this to `true` the day that screen ships — one-line change.
 */
export const maintenanceRouteExists = false;

/**
 * A destination within a scheme. Every value except "hub" maps 1:1 to an
 * existing `/scheme/[id]/<section>` route file; "maintenance" is gated behind
 * `maintenanceRouteExists`; "hub" is the scheme landing screen.
 */
type Section =
  | "finance"
  | "decisions"
  | "meetings"
  | "documents"
  | "maintenance"
  | "hub";

/**
 * `related.type` prefix → section. Grouped by destination screen. Covers every
 * type the notifier emits today plus the brief's forward-compat families (not
 * emitted yet, but routed so they light up for free when they start firing).
 */
const TYPE_SECTIONS: Record<string, Section> = {
  // Decisions — the vote/motion/proxy family.
  decision: "decisions", // emitted (decision.*)
  motion: "decisions", // forward-compat
  vote: "decisions", // forward-compat
  proxy: "decisions", // forward-compat
  // Meetings.
  meeting: "meetings", // emitted (meeting.*, and minutes.drafted → type "meeting")
  // Finance — levies, arrears, trust money.
  levy_notice: "finance", // emitted
  lot: "finance", // emitted (arrears.stage.reached; arrears lives in finance)
  budget: "finance", // forward-compat
  payment: "finance", // forward-compat
  receipt: "finance", // forward-compat
  trust_account: "finance", // forward-compat
  // Documents.
  document: "documents", // forward-compat
  // Maintenance — RFQ / work-order family. No screen yet → falls back to hub.
  work_order: "maintenance", // emitted
  maintenance_request: "maintenance", // emitted
  quote: "maintenance", // forward-compat
  rfq: "maintenance", // forward-compat
  // Scheme hub — no dedicated screen on mobile for these entities.
  community_post: "hub", // emitted (community.comment.created)
  compliance_obligation: "hub", // emitted (compliance.obligation.due)
  owner: "hub", // forward-compat
  committee: "hub", // forward-compat
  scheme: "hub", // forward-compat
  breach_notice: "hub", // forward-compat
  complaint: "hub", // forward-compat
  message: "hub", // forward-compat
  minutes: "hub", // forward-compat (minutes.* family per brief)
};

/** `category` → section, used when `related` is null or its type is unknown. */
const CATEGORY_SECTIONS: Record<NotificationCategory, Section> = {
  finance: "finance",
  maintenance: "maintenance",
  meeting: "meetings",
  decision: "decisions",
  general: "hub",
};

/** Look up a section by the type PREFIX so dotted event types resolve too. */
function sectionForType(type: string): Section | undefined {
  return TYPE_SECTIONS[type.split(".")[0]];
}

/** Build the pathname for a section, honouring routes that don't exist yet. */
function pathnameFor(schemeId: string, section: Section): string {
  switch (section) {
    case "hub":
      return `/scheme/${schemeId}`;
    case "maintenance":
      // Not built yet → land on the scheme hub instead of a dead route.
      return maintenanceRouteExists
        ? `/scheme/${schemeId}/maintenance`
        : `/scheme/${schemeId}`;
    default:
      return `/scheme/${schemeId}/${section}`;
  }
}

/**
 * Resolve a notification to an expo-router push target, or `null` if it isn't
 * routable (no scheme to land in). The entity id (`related.id`) is passed as
 * `params.focus` whenever present, so the destination screen can highlight it.
 *
 * Precedence: `related.type` → `category` → scheme hub.
 */
export function resolveNotificationTarget(
  notification: RoutableNotification,
): NotificationTarget | null {
  const { schemeId, related, category } = notification;
  if (!schemeId) return null; // Nothing to route to.

  const section: Section =
    (related ? sectionForType(related.type) : undefined) ??
    (category && category in CATEGORY_SECTIONS
      ? CATEGORY_SECTIONS[category as NotificationCategory]
      : undefined) ??
    "hub";

  const pathname = pathnameFor(schemeId, section);
  const focus = related?.id;
  return focus ? { pathname, params: { focus } } : { pathname };
}
