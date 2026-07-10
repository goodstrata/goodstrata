/**
 * Notification preferences — the single source of truth for the row/column set
 * of the per-user preferences matrix, shared by the notifier (send-time
 * resolution), the API (validation + the settings payload), and the web UI
 * (labels + layout). Mirrors `NOTIFIER_EVENT_TYPES` in the core notifier: the
 * notification TYPE is the domain event type, the stable semantically-distinct
 * unit (the coarse `category` lumps compliance and community together).
 */

/** The notifier event types users can tune (the matrix rows). */
export const NOTIFICATION_TYPES = [
  "maintenance.request.created",
  "work_order.dispatched",
  "levy.notice.issued",
  "arrears.stage.reached",
  "compliance.obligation.due",
  "decision.requested",
  "minutes.drafted",
  "community.comment.created",
  "conversation.message.sent",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Deliverable channels for a preference. A subset of `MESSAGE_CHANNELS` —
 * "post" is not a live notifier channel and is excluded.
 */
export const NOTIFICATION_PREF_CHANNELS = ["in_app", "email", "sms"] as const;
export type NotificationPrefChannel = (typeof NOTIFICATION_PREF_CHANNELS)[number];

/**
 * The fallback matrix. effective(user, type, channel) = pref row if present,
 * else NOTIFICATION_DEFAULTS[type][channel].
 *
 * Two rules shaped these:
 *  - Never silence (hard): every channel a type fires on TODAY defaults ON
 *    (decision → all three; compliance → in_app + email). A missing row can
 *    therefore never drop a notification that arrives today.
 *  - Sensible product defaults (safe): turning a default ON only ADDS delivery,
 *    so urgent/decision/compliance/arrears default SMS-on; chatty/informational
 *    default SMS-off (and email-off where it's noise). SMS still cannot fire
 *    without a phone on file (resolved at send time).
 */
export const NOTIFICATION_DEFAULTS: Record<
  NotificationType,
  Record<NotificationPrefChannel, boolean>
> = {
  "decision.requested": { in_app: true, email: true, sms: true },
  "compliance.obligation.due": { in_app: true, email: true, sms: true },
  "arrears.stage.reached": { in_app: true, email: true, sms: true },
  "levy.notice.issued": { in_app: true, email: true, sms: false },
  "minutes.drafted": { in_app: true, email: true, sms: false },
  "maintenance.request.created": { in_app: true, email: true, sms: false },
  "work_order.dispatched": { in_app: true, email: false, sms: false },
  "community.comment.created": { in_app: true, email: false, sms: false },
  "conversation.message.sent": { in_app: true, email: true, sms: false },
};

/**
 * Effective on/off for one (type, channel) given an optional stored override.
 * Unknown/new types fall back to in_app-on only (belt-and-braces: a type not
 * yet in the table still rings the bell).
 */
export function effectiveNotificationChannel(
  type: string,
  channel: NotificationPrefChannel,
  override: boolean | undefined,
): boolean {
  if (override !== undefined) return override;
  const def = NOTIFICATION_DEFAULTS[type as NotificationType];
  if (def) return def[channel];
  return channel === "in_app";
}

/** Plain-language grouping for the settings matrix (Registry voice, sentence case). */
export const NOTIFICATION_GROUPS = [
  {
    key: "building",
    label: "Your building",
    types: ["maintenance.request.created", "work_order.dispatched"],
  },
  {
    key: "money",
    label: "Money & compliance",
    types: ["levy.notice.issued", "arrears.stage.reached", "compliance.obligation.due"],
  },
  {
    key: "meetings",
    label: "Meetings & decisions",
    types: ["decision.requested", "minutes.drafted"],
  },
  {
    key: "community",
    label: "Community",
    types: ["community.comment.created"],
  },
  {
    key: "messages",
    label: "Messages",
    types: ["conversation.message.sent"],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  types: readonly NotificationType[];
}[];

/** Row label + helper copy for each type (single source for API + web). */
export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  { label: string; help: string; group: (typeof NOTIFICATION_GROUPS)[number]["key"] }
> = {
  "maintenance.request.created": {
    label: "New maintenance requests",
    help: "When someone reports something that needs fixing.",
    group: "building",
  },
  "work_order.dispatched": {
    label: "Work orders sent",
    help: "When a job goes out to a contractor.",
    group: "building",
  },
  "levy.notice.issued": {
    label: "Levy notices",
    help: "When a new levy notice is issued to you.",
    group: "money",
  },
  "arrears.stage.reached": {
    label: "Overdue levies",
    help: "When a lot's arrears escalate and need attention.",
    group: "money",
  },
  "compliance.obligation.due": {
    label: "Compliance deadlines",
    help: "Insurance, inspections and lodgements coming due.",
    group: "money",
  },
  "decision.requested": {
    label: "Decisions needing your vote",
    help: "When the committee is asked to decide something.",
    group: "meetings",
  },
  "minutes.drafted": {
    label: "Draft minutes",
    help: "When meeting minutes are ready to review.",
    group: "meetings",
  },
  "community.comment.created": {
    label: "Community replies",
    help: "When someone replies to your board post.",
    group: "community",
  },
  "conversation.message.sent": {
    label: "Private messages",
    help: "When someone sends you a private message.",
    group: "messages",
  },
};
