import {
  communityPosts,
  complianceObligations,
  conversationParticipants,
  conversations,
  lots,
  memberships,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import type { EventRecord } from "@goodstrata/events";
import { formatCents, type MembershipRole } from "@goodstrata/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { ServiceContext } from "../context.js";
import { emailBrand, paragraph, renderEmail } from "../email/index.js";
import { notifyUsers } from "./notifications.js";
import { resolveRecipientChannels } from "./notificationPreferences.js";

/**
 * The notifier: a pure-code event consumer (never an LLM) that turns domain
 * events into notifications. Every event type can reach three channels —
 * in-app (the bell), email, and SMS — gated per recipient by their saved
 * preferences (defaults applied where they haven't chosen) and, for SMS, by a
 * phone on file. Wired to the "notify" queue in the API boot.
 */

export const NOTIFIER_EVENT_TYPES = [
  "decision.requested",
  "work_order.dispatched",
  "levy.notice.issued",
  "arrears.stage.reached",
  "minutes.drafted",
  "maintenance.request.created",
  "community.comment.created",
  "compliance.obligation.due",
  "conversation.message.sent",
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

interface EmailContent {
  subject: string;
  html: string;
  text: string;
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
}): EmailContent {
  const { html, text } = renderEmail({
    preheader: opts.preheader,
    heading: opts.heading,
    intro: opts.intro,
    blocks: [paragraph(opts.body)],
    cta: { label: opts.ctaLabel, url: opts.url },
  });
  return { subject: opts.subject, html, text };
}

/**
 * One delivery: resolve the candidate recipients into the channels each opted
 * into, write in-app rows for the in_app subset, then best-effort email/SMS the
 * subsets who chose those channels. Returns the count of in-app rows written
 * (the historical meaning of `created`). A failed email/SMS only logs — the
 * bell row already exists.
 */
async function deliver(
  ctx: ServiceContext,
  content: {
    schemeId: string;
    notificationType: string;
    userIds: string[];
    inApp: {
      title: string;
      body: string;
      category: "finance" | "maintenance" | "meeting" | "decision" | "general";
      related?: { type: string; id: string };
    };
    email?: EmailContent;
    smsBody?: string;
  },
): Promise<number> {
  const resolved = await resolveRecipientChannels(
    ctx,
    content.userIds,
    content.notificationType,
  );

  const created = await notifyUsers(ctx, content.schemeId, resolved.inApp, content.inApp);

  if (content.email) {
    for (const r of resolved.email) {
      try {
        await ctx.integrations.email.send({
          to: r.email,
          subject: content.email.subject,
          text: content.email.text,
          html: content.email.html,
        });
      } catch (err) {
        console.error(`[notifier] email to ${r.email} failed`, err);
      }
    }
  }

  if (content.smsBody) {
    for (const r of resolved.sms) {
      try {
        await ctx.integrations.sms.send({ to: r.phone, body: content.smsBody });
      } catch (err) {
        console.error(`[notifier] sms to ${r.phone} failed`, err);
      }
    }
  }

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
 * All three channels are pref-gated (SMS also needs a phone on file).
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

  // Resolve channel prefs once for the distinct admins (per-user, not per-scheme).
  const distinctUserIds = [...new Set(targets.map((t) => t.userId))];
  const resolved = await resolveRecipientChannels(
    ctx,
    distinctUserIds,
    "compliance.obligation.due",
  );
  const inAppAllowed = new Set(resolved.inApp);

  // Bell: one row per (scheme, admin) pair, for admins who kept in-app on.
  const byScheme = new Map<string, string[]>();
  for (const t of targets) {
    if (!inAppAllowed.has(t.userId)) continue;
    byScheme.set(t.schemeId, [...(byScheme.get(t.schemeId) ?? []), t.userId]);
  }
  let created = 0;
  for (const [schemeId, userIds] of byScheme) {
    const rows = await notifyUsers(ctx, schemeId, userIds, {
      title,
      body,
      category: "general",
      related: { type: "compliance_obligation", id: payload.obligationId },
    });
    created += rows.length;
  }

  // Anchor each admin's CTA to a scheme they administer under this org.
  const anchorScheme = new Map<string, string>();
  for (const t of targets) {
    if (!anchorScheme.has(t.userId)) anchorScheme.set(t.userId, t.schemeId);
  }

  // Email: once per distinct admin who kept email on, best-effort.
  for (const r of resolved.email) {
    const managerUrl = `${emailBrand.urls.app}/schemes/${anchorScheme.get(r.userId)}/manager`;
    const { html, text } = renderEmail({
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
    });
    try {
      await ctx.integrations.email.send({ to: r.email, subject: title, text, html });
    } catch (err) {
      console.error(`[notifier] email to ${r.email} failed`, err);
    }
  }

  // SMS: once per distinct admin who opted in and has a phone on file.
  for (const r of resolved.sms) {
    try {
      await ctx.integrations.sms.send({ to: r.phone, body: `GoodStrata: ${title}` });
    } catch (err) {
      console.error(`[notifier] sms to ${r.phone} failed`, err);
    }
  }

  return { created };
}

/**
 * Handle one dispatched event. Returns how many in-app notifications were
 * created — useful for logs and tests. Safe to call with any catalog event;
 * unknown types are a no-op.
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

    case "levy.notice.issued": {
      const payload = event.payload as {
        levyNoticeId: string;
        lotId: string;
        noticeNumber: string;
        totalCents: number;
        dueOn: string;
      };
      // The lot's levy recipient — only notify if their person links to a login.
      const recipients = await ctx.db
        .select({ userId: people.userId, lotNumber: lots.lotNumber })
        .from(ownerships)
        .innerJoin(people, eq(ownerships.personId, people.id))
        .innerJoin(lots, eq(ownerships.lotId, lots.id))
        .where(
          and(
            eq(ownerships.lotId, payload.lotId),
            eq(ownerships.isLevyRecipient, true),
            isNull(ownerships.endedOn),
          ),
        );
      const userIds = recipients.map((r) => r.userId).filter((id): id is string => id !== null);
      const lotNumber = recipients[0]?.lotNumber;
      const title = `Levy notice ${payload.noticeNumber} issued`;
      const amountLine = `${formatCents(payload.totalCents)} due ${payload.dueOn}${
        lotNumber ? ` for lot ${lotNumber}` : ""
      }.`;
      const created = await deliver(ctx, {
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
      if (!post || !post.authorUserId || post.authorUserId === payload.authorUserId) {
        return { created: 0 };
      }
      const title = "New comment on your post";
      const body = "Someone replied to your community board post.";
      const created = await deliver(ctx, {
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

    default:
      return { created: 0 };
  }
}
