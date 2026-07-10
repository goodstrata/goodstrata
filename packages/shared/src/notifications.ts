/**
 * Notification preferences — the single source of truth for the row/column set
 * of the per-user preferences matrix, shared by the notifier (send-time
 * resolution), the API (validation + the settings payload), and the web UI
 * (labels + layout). Mirrors `NOTIFIER_EVENT_TYPES` in the core notifier: the
 * notification TYPE is the domain event type, the stable semantically-distinct
 * unit (the coarse `category` lumps compliance and community together).
 */

/** The notifier event types users can tune (the matrix rows). Append-only. */
export const NOTIFICATION_TYPES = [
  "maintenance.request.created",
  "work_order.dispatched",
  "levy.notice.issued",
  "arrears.stage.reached",
  "compliance.obligation.due",
  "decision.requested",
  "minutes.drafted",
  "community.comment.created",
  "work_order.completed",
  "payment.received",
  "meeting.scheduled",
  "meeting.notice.issued",
  "decision.resolved",
  "decision.expired",
  "complaint.filed",
  "agent.run.failed",
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
  // Personally-addressed confirmations default to email-on (people expect a
  // receipt / "your job is done" in their inbox); SMS stays opt-in.
  "work_order.completed": { in_app: true, email: true, sms: false },
  "payment.received": { in_app: true, email: true, sms: false },
  // Calendar heads-ups default to bell-only: the statutory meeting notice is
  // already a mandatory email blast (meetings.sendMeetingNotice), so the
  // notifier's email for these two is strictly opt-in — no double letterbox.
  "meeting.scheduled": { in_app: true, email: false, sms: false },
  "meeting.notice.issued": { in_app: true, email: false, sms: false },
  "decision.resolved": { in_app: true, email: true, sms: false },
  "decision.expired": { in_app: true, email: true, sms: false },
  "complaint.filed": { in_app: true, email: true, sms: false },
  // Ops signal for admins — the bell + email, never a text.
  "agent.run.failed": { in_app: true, email: true, sms: false },
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
    types: ["maintenance.request.created", "work_order.dispatched", "work_order.completed"],
  },
  {
    key: "money",
    label: "Money & compliance",
    types: [
      "levy.notice.issued",
      "payment.received",
      "arrears.stage.reached",
      "compliance.obligation.due",
    ],
  },
  {
    key: "meetings",
    label: "Meetings & decisions",
    types: [
      "meeting.scheduled",
      "meeting.notice.issued",
      "decision.requested",
      "decision.resolved",
      "decision.expired",
      "minutes.drafted",
    ],
  },
  {
    key: "community",
    label: "Community",
    types: ["community.comment.created", "complaint.filed"],
  },
  {
    key: "operations",
    label: "Running the scheme",
    types: ["agent.run.failed"],
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
  "work_order.completed": {
    label: "Jobs completed",
    help: "When work you reported is marked done.",
    group: "building",
  },
  "payment.received": {
    label: "Payments received",
    help: "Receipt confirmations when your levy payment arrives.",
    group: "money",
  },
  "meeting.scheduled": {
    label: "Meetings scheduled",
    help: "When a new meeting is put on the calendar.",
    group: "meetings",
  },
  "meeting.notice.issued": {
    label: "Meeting notices",
    help: "When the formal notice of a meeting goes out.",
    group: "meetings",
  },
  "decision.resolved": {
    label: "Decision outcomes",
    help: "When a decision you voted on is resolved.",
    group: "meetings",
  },
  "decision.expired": {
    label: "Decisions expired",
    help: "When a decision lapses without a resolution.",
    group: "meetings",
  },
  "complaint.filed": {
    label: "New complaints",
    help: "When a grievance is lodged with the owners corporation.",
    group: "community",
  },
  "agent.run.failed": {
    label: "Failed automation runs",
    help: "When an assistant run fails and needs a look.",
    group: "operations",
  },
};
