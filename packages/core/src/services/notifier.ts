import {
  communityPosts,
  complaints,
  complianceObligations,
  conversationParticipants,
  conversations,
  decisions,
  decisionVotes,
  levyNotices,
  lots,
  maintenanceRequests,
  meetings,
  memberships,
  ownerships,
  paymentAllocations,
  people,
  pushTokens,
  schemes,
  users,
  workOrders,
} from "@goodstrata/db";
import type { EventRecord } from "@goodstrata/events";
import type { OutboundPush } from "@goodstrata/integrations";
import {
  type CommentEntityType,
  formatCents,
  type MembershipRole,
  type NotificationType,
} from "@goodstrata/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { ServiceContext } from "../context.js";
import { type EmailInput, emailBrand, paragraph, renderEmail } from "../email/index.js";
import { sendEmail as sendCommsEmail, sendSms as sendCommsSms } from "./comms.js";
import { THREAD_OFFICER_ROLES } from "./entityComments.js";
import { resolveRecipientChannels } from "./notificationPreferences.js";
import { notifyUsers } from "./notifications.js";
import { unsubscribeUrl } from "./unsubscribe.js";

/**
 * The notifier: a pure-code event consumer (never an LLM) that turns domain
 * events into notifications. Every event type can reach three channels —
 * in-app (the bell), email, and SMS — gated per recipient by their saved
 * preferences (defaults applied where they haven't chosen) and, for SMS, by a
 * phone on file. Wired to the "notify" queue in the API boot.
 *
 * Delivery guarantees:
 *  - Idempotent per (event, recipient): the bell insert carries a dedupeKey
 *    derived from the trigger event id + recipient, and email/SMS are gated on
 *    that insert actually happening — a redelivered pg-boss job is a no-op.
 *  - Audited: email/SMS go through the comms service, so every send is a
 *    `messages` row (queued → sent/failed with providerMessageId).
 *  - Isolated per recipient: one failed send logs (and its messages row
 *    records "failed") without aborting the rest of the fan-out.
 */

export const NOTIFIER_EVENT_TYPES = [
  "decision.requested",
  "work_order.dispatched",
  "levy.notice.issued",
  "arrears.stage.reached",
  "minutes.drafted",
  "maintenance.request.created",
  "community.comment.created",
  "entity.comment.created",
  "compliance.obligation.due",
  "conversation.message.sent",
  "announcement.published",
  "agenda_item.submitted",
  "agenda_item.accepted",
  "agenda_item.rejected",
  // Append new handled types here (and register them in
  // @goodstrata/shared/notifications.ts so they're preference-tunable).
  "meeting.scheduled",
  "meeting.notice.issued",
  "decision.resolved",
  "decision.expired",
  "payment.received",
  "work_order.completed",
  "complaint.filed",
  "agent.run.failed",
  "motion.close.proposed",
] as const;

/** Roles considered "the committee" for notification fan-out. */
const COMMITTEE_NOTIFY_ROLES: MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
];

/** Base app URL for a scheme, optionally anchored to a section. */
function schemeUrl(schemeId: string, section?: string): string {
  const base = `${emailBrand.urls.app}/schemes/${schemeId}`;
  return section ? `${base}?section=${section}` : base;
}

/**
 * An email as the handlers describe it: subject + the structured renderEmail
 * input. Rendering happens once per recipient (inside `deliver`) so the footer
 * unsubscribe link and List-Unsubscribe header can be personal.
 */
interface EmailSpec {
  subject: string;
  input: EmailInput;
}

/** A plain, on-brand email built from a heading/intro/body + a single CTA. */
function genericEmail(opts: {
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  body: string;
  ctaLabel: string;
  url: string;
}): EmailSpec {
  return {
    subject: opts.subject,
    input: {
      preheader: opts.preheader,
      heading: opts.heading,
      intro: opts.intro,
      blocks: [paragraph(opts.body)],
      cta: { label: opts.ctaLabel, url: opts.url },
    },
  };
}

/**
 * Per-recipient one-click unsubscribe URL, when the deployment has a secret
 * configured. Threaded into both the email footer and the List-Unsubscribe
 * header; absent secret → links are simply omitted.
 */
function unsubscribeUrlFor(
  ctx: ServiceContext,
  userId: string,
  notificationType: NotificationType,
): string | undefined {
  const secret = ctx.integrations.unsubscribeSecret;
  if (!secret) return undefined;
  const appUrl = ctx.integrations.appUrl ?? emailBrand.urls.app;
  return unsubscribeUrl(appUrl, secret, userId, notificationType);
}

/**
 * Send one notifier email through the correspondence log. Never throws — a
 * failed recipient logs (the messages row records "failed") and the fan-out
 * continues.
 */
async function sendNotifierEmail(
  ctx: ServiceContext,
  opts: {
    schemeId: string;
    notificationType: NotificationType;
    recipient: { userId: string; email: string };
    spec: EmailSpec;
    related?: { type: string; id: string };
  },
): Promise<void> {
  try {
    const unsubscribe = unsubscribeUrlFor(ctx, opts.recipient.userId, opts.notificationType);
    const { html, text } = renderEmail({
      ...opts.spec.input,
      ...(unsubscribe ? { unsubscribeUrl: unsubscribe } : {}),
    });
    await sendCommsEmail(ctx, {
      schemeId: opts.schemeId,
      to: opts.recipient.email,
      subject: opts.spec.subject,
      body: text,
      html,
      template: `notifier:${opts.notificationType}`,
      related: opts.related,
      ...(unsubscribe ? { listUnsubscribeUrl: unsubscribe } : {}),
    });
  } catch (err) {
    console.error(`[notifier] email to ${opts.recipient.email} failed`, err);
  }
}

/** SMS twin of {@link sendNotifierEmail} — audited, isolated, never throws. */
async function sendNotifierSms(
  ctx: ServiceContext,
  opts: {
    schemeId: string;
    notificationType: NotificationType;
    recipient: { userId: string; phone: string };
    body: string;
    related?: { type: string; id: string };
  },
): Promise<void> {
  try {
    await sendCommsSms(ctx, {
      schemeId: opts.schemeId,
      to: opts.recipient.phone,
      body: opts.body,
      template: `notifier:${opts.notificationType}`,
      related: opts.related,
    });
  } catch (err) {
    console.error(`[notifier] sms to ${opts.recipient.phone} failed`, err);
  }
}

/**
 * Best-effort OS push to a batch of already-resolved device tokens. One
 * provider call for the whole fan-out (the expo driver chunks ≤100 itself);
 * tokens Expo reports DeviceNotRegistered are pruned here so the next
 * delivery never retries a dead device. Transport failures only log — the
 * bell row already exists.
 */
async function sendPush(ctx: ServiceContext, messages: OutboundPush[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const outcome = await ctx.integrations.push.send(messages);
    if (outcome.invalidTokens.length > 0) {
      await ctx.db.delete(pushTokens).where(inArray(pushTokens.token, outcome.invalidTokens));
    }
  } catch (err) {
    console.error("[notifier] push send failed", err);
  }
}

/**
 * The push `data` payload: the same deep-link anchor the in-app row carries
 * ({ schemeId, category, related }), so the app's tap handler can route with
 * the shared notification-target resolver.
 */
function pushData(
  schemeId: string | null,
  category: string,
  related: { type: string; id: string } | null,
): Record<string, unknown> {
  return { schemeId, category, related };
}

/**
 * One delivery: resolve the candidate recipients into the channels each opted
 * into, write in-app rows for the in_app subset (idempotent on
 * `eventId:userId`), then email/SMS/push the subsets who chose those channels
 * (email/SMS through the comms log). Returns the count of in-app rows actually
 * written (the historical meaning of `created` — a redelivered event returns 0).
 *
 * Idempotency gate: an in-app recipient whose bell insert was absorbed by the
 * dedupe key was already delivered by an earlier attempt of this same event,
 * so their email/SMS/push are skipped too. (A recipient who opted OUT of
 * in-app has no token; their email/SMS stay best-effort.)
 */
async function deliver(
  ctx: ServiceContext,
  content: {
    eventId: string;
    schemeId: string;
    notificationType: NotificationType;
    userIds: string[];
    inApp: {
      title: string;
      body: string;
      category: "finance" | "maintenance" | "meeting" | "decision" | "general";
      related?: { type: string; id: string };
    };
    email?: EmailSpec;
    smsBody?: string;
  },
): Promise<number> {
  const resolved = await resolveRecipientChannels(ctx, content.userIds, content.notificationType);

  const created = await notifyUsers(ctx, content.schemeId, resolved.inApp, content.inApp, {
    dedupeKey: (userId) => `${content.eventId}:${userId}`,
  });

  const inAppSet = new Set(resolved.inApp);
  const fresh = new Set(created.map((n) => n.userId).filter((id): id is string => id !== null));
  const alreadyDelivered = (userId: string) => inAppSet.has(userId) && !fresh.has(userId);

  if (content.email) {
    for (const r of resolved.email) {
      if (alreadyDelivered(r.userId)) continue;
      await sendNotifierEmail(ctx, {
        schemeId: content.schemeId,
        notificationType: content.notificationType,
        recipient: r,
        spec: content.email,
        related: content.inApp.related,
      });
    }
  }

  if (content.smsBody) {
    for (const r of resolved.sms) {
      if (alreadyDelivered(r.userId)) continue;
      await sendNotifierSms(ctx, {
        schemeId: content.schemeId,
        notificationType: content.notificationType,
        recipient: r,
        body: content.smsBody,
        related: content.inApp.related,
      });
    }
  }

  // Push mirrors the in-app content — every registered device of each
  // recipient who kept the push channel on (redelivered events skip, same
  // gate as email/SMS).
  await sendPush(
    ctx,
    resolved.push
      .filter((r) => !alreadyDelivered(r.userId))
      .map((r) => ({
        to: r.token,
        title: content.inApp.title,
        body: content.inApp.body,
        data: pushData(content.schemeId, content.inApp.category, content.inApp.related ?? null),
      })),
  );

  return created.length;
}

/**
 * Distinct users holding any of the given active roles in the scheme.
 * `memberships.userId` is nullable (ON DELETE SET NULL severs a deleted
 * account) — `isNotNull` filters those out at the query, and the map/filter
 * below narrows the TS type; a role-holder with no login left can't be
 * notified anyway.
 */
async function userIdsWithRoles(
  ctx: ServiceContext,
  schemeId: string,
  roles: readonly MembershipRole[],
): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.schemeId, schemeId),
        inArray(memberships.role, [...roles]),
        isNull(memberships.endedOn),
        isNotNull(memberships.userId),
      ),
    );
  return rows.map((r) => r.userId).filter((id): id is string => id !== null);
}

async function allMemberUserIds(ctx: ServiceContext, schemeId: string): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.schemeId, schemeId),
        isNull(memberships.endedOn),
        isNotNull(memberships.userId),
      ),
    );
  return rows.map((r) => r.userId).filter((id): id is string => id !== null);
}

/**
 * The lot's levy recipients who link to a login, plus the lot number for copy.
 * Shared by the levy-notice and payment-receipt handlers.
 */
async function levyRecipientUserIds(
  ctx: ServiceContext,
  lotId: string,
): Promise<{ userIds: string[]; lotNumber: string | undefined }> {
  const recipients = await ctx.db
    .select({ userId: people.userId, lotNumber: lots.lotNumber })
    .from(ownerships)
    .innerJoin(people, eq(ownerships.personId, people.id))
    .innerJoin(lots, eq(ownerships.lotId, lots.id))
    .where(
      and(
        eq(ownerships.lotId, lotId),
        eq(ownerships.isLevyRecipient, true),
        isNull(ownerships.endedOn),
      ),
    );
  return {
    userIds: recipients.map((r) => r.userId).filter((id): id is string => id !== null),
    lotNumber: recipients[0]?.lotNumber,
  };
}

/**
 * "Org admins": users holding an active `manager_admin` membership in any
 * scheme under the organisation. Memberships are scheme-scoped, so each pair
 * is returned — the bell is per scheme, so an admin sees the nudge in every
 * scheme they administer under the org (email is still sent once per user).
 */
async function orgAdminTargets(
  ctx: ServiceContext,
  organizationId: string,
): Promise<{ schemeId: string; userId: string }[]> {
  const rows = await ctx.db
    .selectDistinct({ schemeId: memberships.schemeId, userId: memberships.userId })
    .from(memberships)
    .innerJoin(schemes, eq(memberships.schemeId, schemes.id))
    .where(
      and(
        eq(schemes.organizationId, organizationId),
        eq(memberships.role, "manager_admin"),
        isNull(memberships.endedOn),
        isNotNull(memberships.userId),
      ),
    );
  return rows.filter((r): r is { schemeId: string; userId: string } => r.userId !== null);
}

/**
 * Org-scoped `compliance.obligation.due` (manager-level kinds: `pi_expiry`,
 * `registration_renewal`) carries no schemeId, so it can't ride the scheme
 * fan-out. Instead: bell every org admin in every scheme they administer under
 * the org, and email/SMS each admin once, linking to the manager back-office.
 * All three channels are pref-gated (SMS also needs a phone on file), and the
 * whole delivery is idempotent on the event id like `deliver`.
 */
async function handleOrgObligationDue(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<{ created: number }> {
  const payload = event.payload as {
    obligationId: string;
    kind: string;
    dueOn: string;
    status: string;
    organizationId: string | null;
  };
  if (!payload.organizationId) return { created: 0 };

  const targets = await orgAdminTargets(ctx, payload.organizationId);
  if (targets.length === 0) return { created: 0 };

  // Prefer the obligation's human title ("Manager PI insurance expiry", …);
  // fall back to the kind if the row is gone.
  const obligation = await ctx.db.query.complianceObligations.findFirst({
    where: eq(complianceObligations.id, payload.obligationId),
  });
  const label = obligation?.title ?? payload.kind.replace(/_/g, " ");
  const overdue = payload.status === "overdue";

  const title = overdue ? `Overdue: ${label}` : `${label} — due ${payload.dueOn}`;
  const body = overdue
    ? `${label} was due ${payload.dueOn}. Renew now to keep the registered-manager requirements met.`
    : `${label} is approaching its due date (${payload.dueOn}). Review it in the manager back-office.`;
  const related = { type: "compliance_obligation", id: payload.obligationId };

  // Resolve channel prefs once for the distinct admins (per-user, not per-scheme).
  const distinctUserIds = [...new Set(targets.map((t) => t.userId))];
  const resolved = await resolveRecipientChannels(
    ctx,
    distinctUserIds,
    "compliance.obligation.due",
  );
  const inAppAllowed = new Set(resolved.inApp);

  // Bell: one row per (scheme, admin) pair, for admins who kept in-app on.
  // Idempotent per (event, scheme, admin) so a redelivered job adds nothing.
  const byScheme = new Map<string, string[]>();
  for (const t of targets) {
    if (!inAppAllowed.has(t.userId)) continue;
    byScheme.set(t.schemeId, [...(byScheme.get(t.schemeId) ?? []), t.userId]);
  }
  let created = 0;
  const fresh = new Set<string>();
  for (const [schemeId, userIds] of byScheme) {
    const rows = await notifyUsers(
      ctx,
      schemeId,
      userIds,
      { title, body, category: "general", related },
      { dedupeKey: (userId) => `${event.id}:${schemeId}:${userId}` },
    );
    created += rows.length;
    for (const row of rows) {
      if (row.userId) fresh.add(row.userId);
    }
  }
  const alreadyDelivered = (userId: string) => inAppAllowed.has(userId) && !fresh.has(userId);

  // Anchor each admin's CTA (and correspondence-log scheme) to a scheme they
  // administer under this org.
  const anchorScheme = new Map<string, string>();
  for (const t of targets) {
    if (!anchorScheme.has(t.userId)) anchorScheme.set(t.userId, t.schemeId);
  }

  // Email: once per distinct admin who kept email on, audited + isolated.
  for (const r of resolved.email) {
    if (alreadyDelivered(r.userId)) continue;
    const schemeId = anchorScheme.get(r.userId);
    if (!schemeId) continue;
    const managerUrl = `${emailBrand.urls.app}/schemes/${schemeId}/manager`;
    await sendNotifierEmail(ctx, {
      schemeId,
      notificationType: "compliance.obligation.due",
      recipient: r,
      related,
      spec: {
        subject: title,
        input: {
          preheader: overdue
            ? `${label} was due ${payload.dueOn}.`
            : `${label} is due ${payload.dueOn}.`,
          heading: overdue ? "Manager compliance overdue" : "Manager compliance due soon",
          intro: overdue
            ? `${label} was due ${payload.dueOn} and is now overdue.`
            : `${label} is due ${payload.dueOn}.`,
          blocks: [
            paragraph(
              "Registration and professional-indemnity cover are registered-manager requirements. Open the manager back-office to record the renewal and clear this obligation.",
            ),
          ],
          cta: { label: "Review registration & PI", url: managerUrl },
        },
      },
    });
  }

  // SMS: once per distinct admin who opted in and has a phone on file.
  for (const r of resolved.sms) {
    if (alreadyDelivered(r.userId)) continue;
    const schemeId = anchorScheme.get(r.userId);
    if (!schemeId) continue;
    await sendNotifierSms(ctx, {
      schemeId,
      notificationType: "compliance.obligation.due",
      recipient: r,
      body: `GoodStrata: ${title}`,
      related,
    });
  }

  // Push: every registered device of each opted-in admin, anchored (like the
  // email CTA) to a scheme they administer so the tap has somewhere to land.
  await sendPush(
    ctx,
    resolved.push.map((r) => ({
      to: r.token,
      title,
      body,
      data: pushData(anchorScheme.get(r.userId) ?? null, "general", {
        type: "compliance_obligation",
        id: payload.obligationId,
      }),
    })),
  );

  return { created };
}

/**
 * Handle one dispatched event. Returns how many in-app notifications were
 * created — useful for logs and tests. Safe to call with any catalog event;
 * unknown types are a no-op, and a redelivered event creates (and re-sends)
 * nothing.
 */
export async function handleEventForNotifications(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<{ created: number }> {
  const schemeId = event.schemeId;
  if (!schemeId) {
    // Org-scoped compliance obligations (pi_expiry / registration_renewal)
    // publish without a scheme; route them to the org admins instead.
    if (event.type === "compliance.obligation.due") {
      return await handleOrgObligationDue(ctx, event);
    }
    return { created: 0 };
  }

  switch (event.type) {
    case "decision.requested": {
      const payload = event.payload as { decisionId: string; title: string; kind: string };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      if (committee.length === 0) return { created: 0 };

      const title = `Decision requested: ${payload.title}`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "decision.requested",
        userIds: committee,
        inApp: {
          title,
          body: "A decision needs your vote. Open the decision to review and respond.",
          category: "decision",
          related: { type: "decision", id: payload.decisionId },
        },
        email: genericEmail({
          subject: title,
          preheader: `A decision needs your vote: ${payload.title}.`,
          heading: "A decision needs your vote",
          intro: `The committee has been asked to decide: ${payload.title}.`,
          body: "Open the decision in your inbox to review the details and record your vote. Your response is kept on the record.",
          ctaLabel: "Review & vote",
          url: schemeUrl(schemeId, "decisions"),
        }),
        smsBody: `GoodStrata: decision needs your vote — ${payload.title}`,
      });
      return { created };
    }

    case "work_order.dispatched": {
      const payload = event.payload as { workOrderId: string };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const title = "Work order dispatched";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "work_order.dispatched",
        userIds: committee,
        inApp: {
          title,
          body: "A work order has been dispatched to a contractor.",
          category: "maintenance",
          related: { type: "work_order", id: payload.workOrderId },
        },
        email: genericEmail({
          subject: title,
          preheader: "A work order has been dispatched to a contractor.",
          heading: title,
          intro: "A work order has been dispatched to a contractor.",
          body: "Open maintenance to see the job, the contractor, and its status.",
          ctaLabel: "Open maintenance",
          url: schemeUrl(schemeId, "maintenance"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "motion.close.proposed": {
      // The AI chair thinks discussion is done — nudge the officers to run the
      // binding close/tally themselves. Bell-only: it is a live-meeting prompt,
      // not correspondence.
      const payload = event.payload as { motionId: string; title: string };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "motion.close.proposed",
        userIds: committee,
        inApp: {
          title: `Motion ready to close: ${payload.title}`,
          body: "The AI chair suggests discussion is finished. Close the motion to tally the votes.",
          category: "meeting",
          related: { type: "motion", id: payload.motionId },
        },
      });
      return { created };
    }

    case "levy.notice.issued": {
      const payload = event.payload as {
        levyNoticeId: string;
        lotId: string;
        noticeNumber: string;
        totalCents: number;
        dueOn: string;
      };
      // The lot's levy recipient — only notify if their person links to a login.
      const { userIds, lotNumber } = await levyRecipientUserIds(ctx, payload.lotId);
      const title = `Levy notice ${payload.noticeNumber} issued`;
      const amountLine = `${formatCents(payload.totalCents)} due ${payload.dueOn}${
        lotNumber ? ` for lot ${lotNumber}` : ""
      }.`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "levy.notice.issued",
        userIds,
        inApp: {
          title,
          body: amountLine,
          category: "finance",
          related: { type: "levy_notice", id: payload.levyNoticeId },
        },
        email: genericEmail({
          subject: title,
          preheader: amountLine,
          heading: "Your levy notice is ready",
          intro: `Levy notice ${payload.noticeNumber} has been issued.`,
          body: `${amountLine} Open your levies to view the notice and payment details.`,
          ctaLabel: "View levy notice",
          url: schemeUrl(schemeId, "levies"),
        }),
        smsBody: `GoodStrata: levy notice ${payload.noticeNumber} — ${amountLine}`,
      });
      return { created };
    }

    case "arrears.stage.reached": {
      const payload = event.payload as {
        lotId: string;
        stage: number;
        daysOverdue: number;
        outstandingCents: number;
      };
      if (payload.stage < 3) return { created: 0 };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const title = `Arrears escalated to stage ${payload.stage}`;
      const body = `A lot is ${payload.daysOverdue} days overdue with ${formatCents(
        payload.outstandingCents,
      )} outstanding.`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "arrears.stage.reached",
        userIds: committee,
        inApp: {
          title,
          body,
          category: "finance",
          related: { type: "lot", id: payload.lotId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "Arrears need attention",
          intro: title,
          body: `${body} Open arrears to review the ledger and next steps.`,
          ctaLabel: "Review arrears",
          url: schemeUrl(schemeId, "arrears"),
        }),
        smsBody: `GoodStrata: ${title} — ${body}`,
      });
      return { created };
    }

    case "minutes.drafted": {
      const payload = event.payload as { meetingId: string; documentId: string };
      const members = await allMemberUserIds(ctx, schemeId);
      const title = "Meeting minutes drafted";
      const body = "Draft minutes are ready to review in the documents section.";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "minutes.drafted",
        userIds: members,
        inApp: {
          title,
          body,
          category: "meeting",
          related: { type: "meeting", id: payload.meetingId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "Draft minutes are ready",
          intro: body,
          body: "Open documents to read the draft minutes and raise any corrections.",
          ctaLabel: "Read draft minutes",
          url: schemeUrl(schemeId, "documents"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "maintenance.request.created": {
      const payload = event.payload as { requestId: string; title: string };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const title = `New maintenance request: ${payload.title}`;
      const body = "A new maintenance request has been lodged and needs triage.";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "maintenance.request.created",
        userIds: committee,
        inApp: {
          title,
          body,
          category: "maintenance",
          related: { type: "maintenance_request", id: payload.requestId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "A maintenance request needs triage",
          intro: `A new maintenance request was lodged: ${payload.title}.`,
          body: "Open maintenance to triage the request and assign next steps.",
          ctaLabel: "Triage request",
          url: schemeUrl(schemeId, "maintenance"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "community.comment.created": {
      const payload = event.payload as {
        commentId: string;
        postId: string;
        authorUserId: string;
      };
      const post = await ctx.db.query.communityPosts.findFirst({
        where: eq(communityPosts.id, payload.postId),
      });
      // Don't notify the author about their own comment. A null authorUserId
      // means the post's author account has since been deleted — no login
      // left to notify.
      if (!post?.authorUserId || post.authorUserId === payload.authorUserId) {
        return { created: 0 };
      }
      const title = "New comment on your post";
      const body = "Someone replied to your community board post.";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "community.comment.created",
        userIds: [post.authorUserId],
        inApp: {
          title,
          body,
          category: "general",
          related: { type: "community_post", id: payload.postId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: title,
          intro: body,
          body: "Open the community board to read the reply and respond.",
          ctaLabel: "Open community board",
          url: schemeUrl(schemeId, "community"),
        }),
        smsBody: `GoodStrata: ${body}`,
      });
      return { created };
    }

    case "entity.comment.created": {
      const payload = event.payload as {
        commentId: string;
        entityType: CommentEntityType;
        entityId: string;
        authorUserId: string;
      };
      const isMaintenance = payload.entityType === "maintenance_request";

      // Resolve the member side of the thread (the requester's / complainant's
      // login) — null when the person isn't linked to an account.
      let memberUserId: string | null = null;
      let requestTitle: string | null = null;
      if (isMaintenance) {
        const request = await ctx.db.query.maintenanceRequests.findFirst({
          where: eq(maintenanceRequests.id, payload.entityId),
        });
        if (!request) return { created: 0 };
        requestTitle = request.title;
        if (request.reportedByPersonId) {
          const person = await ctx.db.query.people.findFirst({
            where: eq(people.id, request.reportedByPersonId),
          });
          memberUserId = person?.userId ?? null;
        }
      } else {
        const complaint = await ctx.db.query.complaints.findFirst({
          where: eq(complaints.id, payload.entityId),
        });
        if (!complaint) return { created: 0 };
        const person = await ctx.db.query.people.findFirst({
          where: eq(people.id, complaint.complainantPersonId),
        });
        memberUserId = person?.userId ?? null;
      }

      // Notify the other side of the conversation: the member's comment goes
      // to the officer tier that works the thread; an officer's goes to the
      // member. Never the author themselves.
      const counterparty =
        payload.authorUserId === memberUserId
          ? await userIdsWithRoles(ctx, schemeId, THREAD_OFFICER_ROLES)
          : memberUserId
            ? [memberUserId]
            : [];
      const recipients = counterparty.filter((id) => id !== payload.authorUserId);
      if (recipients.length === 0) return { created: 0 };

      // The complaint's subject stays out of notification copy — the bell and
      // email surfaces are less guarded than the officer-gated register.
      const title = isMaintenance
        ? `New reply on maintenance request: ${requestTitle}`
        : "New reply on a complaint";
      const body = isMaintenance
        ? "There's a new reply on the maintenance request thread."
        : "There's a new reply on a complaint you're involved in.";
      const section = isMaintenance ? "maintenance" : "grievances";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "entity.comment.created",
        userIds: recipients,
        inApp: {
          title,
          body,
          category: isMaintenance ? "maintenance" : "general",
          related: { type: payload.entityType, id: payload.entityId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: title,
          intro: body,
          body: "Open the thread to read the reply and respond.",
          ctaLabel: "Open the thread",
          url: schemeUrl(schemeId, section),
        }),
        smsBody: `GoodStrata: ${body}`,
      });
      return { created };
    }

    case "conversation.message.sent": {
      const payload = event.payload as {
        conversationId: string;
        messageId: string;
        senderUserId: string;
      };
      // Fan out to the OTHER participants — never the sender. The audience is
      // the participant snapshot, not a role query: only people already in the
      // thread learn about it. Message content stays out of the notification —
      // it is private; the bell/email just say who wrote and link into the app.
      const participantRows = await ctx.db.query.conversationParticipants.findMany({
        where: eq(conversationParticipants.conversationId, payload.conversationId),
        columns: { userId: true },
      });
      const recipients = participantRows
        .map((p) => p.userId)
        .filter((id) => id !== payload.senderUserId);
      if (recipients.length === 0) return { created: 0 };

      const [conversation, sender] = await Promise.all([
        ctx.db.query.conversations.findFirst({
          where: eq(conversations.id, payload.conversationId),
          columns: { subject: true },
        }),
        ctx.db.query.users.findFirst({
          where: eq(users.id, payload.senderUserId),
          columns: { name: true },
        }),
      ]);
      const senderName = sender?.name ?? "A member";
      const title = `New message from ${senderName}`;
      const body = conversation?.subject
        ? `${senderName} sent a message in "${conversation.subject}".`
        : `${senderName} sent you a private message.`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "conversation.message.sent",
        userIds: recipients,
        inApp: {
          title,
          body,
          category: "general",
          related: { type: "conversation", id: payload.conversationId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: title,
          intro: body,
          body: "Open your messages to read it and reply. The message itself stays in the app.",
          ctaLabel: "Open messages",
          url: schemeUrl(schemeId, "messages"),
        }),
        smsBody: `GoodStrata: ${body}`,
      });
      return { created };
    }

    case "agenda_item.submitted": {
      const payload = event.payload as {
        agendaItemId: string;
        meetingId: string;
        title: string;
        submittedByPersonId: string;
      };
      // The officers review owner-submitted motions. Don't ping the submitter
      // about their own proposal if they happen to hold an officer role.
      const officers = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const submitter = await ctx.db.query.people.findFirst({
        where: eq(people.id, payload.submittedByPersonId),
      });
      const recipients = officers.filter((id) => id !== submitter?.userId);
      const title = `Motion proposed: ${payload.title}`;
      const body =
        "An owner has proposed a motion for an upcoming meeting. Review it to accept it onto the agenda or reject it with a reason.";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "agenda_item.submitted",
        userIds: recipients,
        inApp: {
          title,
          body,
          category: "meeting",
          related: { type: "meeting", id: payload.meetingId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "An owner proposed a motion",
          intro: `A motion has been proposed for an upcoming meeting: ${payload.title}.`,
          body: "Open the meeting to review the proposal and accept or reject it.",
          ctaLabel: "Review proposal",
          url: schemeUrl(schemeId, "meetings"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "agenda_item.accepted":
    case "agenda_item.rejected": {
      const payload = event.payload as {
        agendaItemId: string;
        meetingId: string;
        reason?: string;
        submittedByPersonId: string | null;
      };
      // Tell the submitter what became of their proposal — only if their
      // person record links to a login.
      const submitter = payload.submittedByPersonId
        ? await ctx.db.query.people.findFirst({
            where: eq(people.id, payload.submittedByPersonId),
          })
        : null;
      if (!submitter?.userId) return { created: 0 };
      const accepted = event.type === "agenda_item.accepted";
      const title = accepted
        ? "Your proposed motion was accepted"
        : "Your proposed motion was declined";
      const body = accepted
        ? "Your proposal is on the meeting agenda and will be put as a motion."
        : `The committee declined your proposal${payload.reason ? `: ${payload.reason}` : "."}`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: event.type,
        userIds: [submitter.userId],
        inApp: {
          title,
          body,
          category: "meeting",
          related: { type: "meeting", id: payload.meetingId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: title,
          intro: body,
          body: "Open the meeting to see the agenda and what happens next.",
          ctaLabel: "Open meeting",
          url: schemeUrl(schemeId, "meetings"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "compliance.obligation.due": {
      const payload = event.payload as {
        obligationId: string;
        kind: string;
        dueOn: string;
        status: string;
        escalationState: string;
        responsibleRole: string | null;
      };
      // Fan out to the responsible role (falling back to the committee), so the
      // people answerable for the obligation see it approaching/overdue.
      const roles: MembershipRole[] =
        payload.responsibleRole &&
        COMMITTEE_NOTIFY_ROLES.includes(payload.responsibleRole as MembershipRole)
          ? [payload.responsibleRole as MembershipRole]
          : COMMITTEE_NOTIFY_ROLES;
      const recipients = await userIdsWithRoles(ctx, schemeId, roles);
      const overdue = payload.status === "overdue";
      const kindLabel = payload.kind.replace(/_/g, " ");
      const title = overdue
        ? `Overdue: ${kindLabel}`
        : `Compliance due ${payload.dueOn}: ${kindLabel}`;
      const body = overdue
        ? `A compliance obligation is overdue (was due ${payload.dueOn}). Act to bring it back into compliance.`
        : `A compliance obligation is approaching its due date (${payload.dueOn}).`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "compliance.obligation.due",
        userIds: recipients,
        inApp: {
          title,
          body,
          category: "general",
          related: { type: "compliance_obligation", id: payload.obligationId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: overdue ? "Compliance overdue" : "Compliance due soon",
          intro: title,
          body: `${body} Open compliance to record what's been done.`,
          ctaLabel: "Open compliance",
          url: schemeUrl(schemeId, "compliance"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "announcement.published": {
      const payload = event.payload as {
        id: string;
        title: string;
        audience: string;
        body: string;
      };
      // Audience → recipients: committee notices reach the officer tier;
      // owner notices reach lot owners (plus the officers, who can read
      // everything anyway); building-wide notices reach every member.
      const recipients =
        payload.audience === "committee"
          ? await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES)
          : payload.audience === "owners"
            ? await userIdsWithRoles(ctx, schemeId, ["owner", ...COMMITTEE_NOTIFY_ROLES])
            : await allMemberUserIds(ctx, schemeId);
      const preview = payload.body.length > 180 ? `${payload.body.slice(0, 177)}…` : payload.body;
      // The email carries the full notice: one paragraph per blank-line-
      // separated block (paragraph blocks HTML-escape their text). Rendered
      // per recipient inside deliver so the unsubscribe footer is personal.
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "announcement.published",
        userIds: recipients,
        inApp: {
          title: payload.title,
          body: preview,
          category: "general",
          related: { type: "announcement", id: payload.id },
        },
        email: {
          subject: `Announcement: ${payload.title}`,
          input: {
            preheader: preview,
            heading: payload.title,
            intro: "A new announcement was posted for your owners corporation.",
            blocks: payload.body
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map(paragraph),
            cta: { label: "Open announcements", url: schemeUrl(schemeId, "announcements") },
          },
        },
      });
      return { created };
    }

    case "meeting.scheduled": {
      const payload = event.payload as {
        meetingId: string;
        kind: string;
        title: string;
        scheduledAt: string;
      };
      const members = await allMemberUserIds(ctx, schemeId);
      const when = payload.scheduledAt.slice(0, 10);
      const title = `Meeting scheduled: ${payload.title}`;
      const body = `A ${payload.kind.replace(/_/g, " ")} meeting has been scheduled for ${when}.`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "meeting.scheduled",
        userIds: members,
        inApp: {
          title,
          body,
          category: "meeting",
          related: { type: "meeting", id: payload.meetingId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "A meeting is on the calendar",
          intro: body,
          body: "Open meetings to see the agenda as it takes shape. The formal notice will follow separately.",
          ctaLabel: "Open meetings",
          url: schemeUrl(schemeId, "meetings"),
        }),
        smsBody: `GoodStrata: ${title} — ${when}`,
      });
      return { created };
    }

    case "meeting.notice.issued": {
      const payload = event.payload as { meetingId: string; recipients: number };
      const meeting = await ctx.db.query.meetings.findFirst({
        where: eq(meetings.id, payload.meetingId),
      });
      const members = await allMemberUserIds(ctx, schemeId);
      const label = meeting ? `Notice of meeting: ${meeting.title}` : "Notice of meeting issued";
      const when = meeting ? meeting.scheduledAt.toISOString().slice(0, 10) : null;
      const body = when
        ? `The formal meeting notice has been issued. The meeting is on ${when}.`
        : "The formal meeting notice has been issued.";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "meeting.notice.issued",
        userIds: members,
        inApp: {
          title: label,
          body,
          category: "meeting",
          related: { type: "meeting", id: payload.meetingId },
        },
        // Email defaults OFF for this type (the statutory notice is its own
        // mandatory email blast) — this spec only serves explicit opt-ins.
        email: genericEmail({
          subject: label,
          preheader: body,
          heading: "The meeting notice is out",
          intro: body,
          body: "Open meetings to read the notice, the agenda and the papers.",
          ctaLabel: "Open meetings",
          url: schemeUrl(schemeId, "meetings"),
        }),
        smsBody: `GoodStrata: ${label}`,
      });
      return { created };
    }

    case "decision.resolved":
    case "decision.expired": {
      const payload = event.payload as { decisionId: string; optionId?: string };
      const decision = await ctx.db.query.decisions.findFirst({
        where: eq(decisions.id, payload.decisionId),
      });
      if (!decision) return { created: 0 };
      // The people who cast a ballot; when nobody voted (system-default
      // resolution, or an expiry nobody answered) fall back to the committee
      // that was asked.
      const voteRows = await ctx.db.query.decisionVotes.findMany({
        where: eq(decisionVotes.decisionId, payload.decisionId),
      });
      let recipients = voteRows.map((v) => v.userId).filter((id): id is string => id !== null);
      if (recipients.length === 0) {
        recipients = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      }
      const expired = event.type === "decision.expired";
      const title = expired
        ? `Decision expired: ${decision.title}`
        : `Decision resolved: ${decision.title}`;
      const body = expired
        ? "The decision reached its due date without a resolution and has lapsed."
        : `Outcome: ${payload.optionId ?? "resolved"}. Open the decision to see the resolution on the record.`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: expired ? "decision.expired" : "decision.resolved",
        userIds: recipients,
        inApp: {
          title,
          body,
          category: "decision",
          related: { type: "decision", id: payload.decisionId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: expired ? "A decision expired" : "A decision was resolved",
          intro: title,
          body: `${body} Every resolution is kept on the audit log.`,
          ctaLabel: "Open decisions",
          url: schemeUrl(schemeId, "decisions"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "payment.received": {
      const payload = event.payload as {
        paymentId: string;
        amountCents: number;
        rail?: string;
      };
      const amount = formatCents(payload.amountCents);
      const related = { type: "payment", id: payload.paymentId };
      let created = 0;

      // Receipt confirmation to the paying lot's owner — resolvable only when
      // the payment matched a levy notice (allocation → notice → lot).
      const allocation = await ctx.db.query.paymentAllocations.findFirst({
        where: eq(paymentAllocations.paymentId, payload.paymentId),
      });
      const notice = allocation
        ? await ctx.db.query.levyNotices.findFirst({
            where: eq(levyNotices.id, allocation.levyNoticeId),
          })
        : undefined;
      if (notice) {
        const { userIds, lotNumber } = await levyRecipientUserIds(ctx, notice.lotId);
        const ownerBody = `We received your payment of ${amount} for levy notice ${notice.noticeNumber}${
          lotNumber ? ` (lot ${lotNumber})` : ""
        }.`;
        created += await deliver(ctx, {
          eventId: event.id,
          schemeId,
          notificationType: "payment.received",
          userIds,
          inApp: {
            title: `Payment received — ${amount}`,
            body: ownerBody,
            category: "finance",
            related,
          },
          email: genericEmail({
            subject: `Payment received — ${amount}`,
            preheader: ownerBody,
            heading: "Thanks — payment received",
            intro: ownerBody,
            body: "Open your levies to see the receipt and your lot's up-to-date balance.",
            ctaLabel: "View your levies",
            url: schemeUrl(schemeId, "levies"),
          }),
          smsBody: `GoodStrata: payment of ${amount} received. Thank you.`,
        });
      }

      // The treasurer sees every inbound payment — matched or parked.
      const treasurers = await userIdsWithRoles(ctx, schemeId, ["treasurer"]);
      const treasurerBody = notice
        ? `${amount} received and matched to levy notice ${notice.noticeNumber}.`
        : `${amount} received${payload.rail === "manual" ? " (recorded manually)" : ""} — not yet matched to a levy notice.`;
      created += await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "payment.received",
        userIds: treasurers,
        inApp: {
          title: `Payment received — ${amount}`,
          body: treasurerBody,
          category: "finance",
          related,
        },
        email: genericEmail({
          subject: `Payment received — ${amount}`,
          preheader: treasurerBody,
          heading: "A payment arrived",
          intro: treasurerBody,
          body: "Open finance to review the payment, its allocation and the suspense queue.",
          ctaLabel: "Open finance",
          url: schemeUrl(schemeId, "finance"),
        }),
      });
      return { created };
    }

    case "work_order.completed": {
      const payload = event.payload as { workOrderId: string };
      // The original requester: work order → maintenance request → reporter →
      // their login. Any missing link means nobody to address.
      const workOrder = await ctx.db.query.workOrders.findFirst({
        where: eq(workOrders.id, payload.workOrderId),
      });
      if (!workOrder?.requestId) return { created: 0 };
      const request = await ctx.db.query.maintenanceRequests.findFirst({
        where: eq(maintenanceRequests.id, workOrder.requestId),
      });
      if (!request?.reportedByPersonId) return { created: 0 };
      const reporter = await ctx.db.query.people.findFirst({
        where: eq(people.id, request.reportedByPersonId),
      });
      if (!reporter?.userId) return { created: 0 };

      const title = `Work completed: ${request.title}`;
      const body = "The job you reported has been marked complete.";
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "work_order.completed",
        userIds: [reporter.userId],
        inApp: {
          title,
          body,
          category: "maintenance",
          related: { type: "work_order", id: payload.workOrderId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "Your job is done",
          intro: `${body} (${request.title})`,
          body: "Open maintenance to see the completion details — and flag it if something still isn't right.",
          ctaLabel: "Open maintenance",
          url: schemeUrl(schemeId, "maintenance"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "complaint.filed": {
      const payload = event.payload as {
        complaintId: string;
        subject: string;
        meetByDate: string;
      };
      const officers = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const title = `New complaint: ${payload.subject}`;
      const body = `A complaint has been lodged under the grievance procedure. It must be dealt with by ${payload.meetByDate}.`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "complaint.filed",
        userIds: officers,
        inApp: {
          title,
          body,
          category: "general",
          related: { type: "complaint", id: payload.complaintId },
        },
        email: genericEmail({
          subject: title,
          preheader: body,
          heading: "A complaint needs attention",
          intro: body,
          body: "Open grievances to review the complaint and start the response — the 28-day statutory clock is running.",
          ctaLabel: "Open grievances",
          url: schemeUrl(schemeId, "grievances"),
        }),
        smsBody: `GoodStrata: ${title}`,
      });
      return { created };
    }

    case "agent.run.failed": {
      const payload = event.payload as { agentRunId: string; agent: string; error: string };
      // Ops signal → org admins (every admin under the scheme's organisation);
      // a standalone scheme falls back to its own manager_admin role-holders.
      const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
      const admins = scheme?.organizationId
        ? [...new Set((await orgAdminTargets(ctx, scheme.organizationId)).map((t) => t.userId))]
        : await userIdsWithRoles(ctx, schemeId, ["manager_admin"]);
      if (admins.length === 0) return { created: 0 };

      const reason = payload.error.length > 200 ? `${payload.error.slice(0, 200)}…` : payload.error;
      const title = `Agent run failed: ${payload.agent}`;
      const body = `The ${payload.agent} agent run failed: ${reason}`;
      const created = await deliver(ctx, {
        eventId: event.id,
        schemeId,
        notificationType: "agent.run.failed",
        userIds: admins,
        inApp: {
          title,
          body,
          category: "general",
          related: { type: "agent_run", id: payload.agentRunId },
        },
        email: genericEmail({
          subject: title,
          preheader: `The ${payload.agent} agent run failed.`,
          heading: "An agent run failed",
          intro: `The ${payload.agent} agent run failed and may need a retry or a human follow-up.`,
          body: `Error: ${reason}`,
          ctaLabel: "Review agent runs",
          url: schemeUrl(schemeId, "agents"),
        }),
      });
      return { created };
    }

    default:
      return { created: 0 };
  }
}
