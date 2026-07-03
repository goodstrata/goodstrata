import {
  communityPosts,
  complianceObligations,
  lots,
  memberships,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import type { EventRecord } from "@goodstrata/events";
import { formatCents, type MembershipRole } from "@goodstrata/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ServiceContext } from "../context.js";
import { emailBrand, paragraph, renderEmail } from "../email/index.js";
import { notifyUsers } from "./notifications.js";

/**
 * The notifier: a pure-code event consumer (never an LLM) that turns domain
 * events into in-app notifications — and, for decision requests and org-level
 * compliance obligations, an email/SMS nudge to the people answerable.
 * Wired to the "notify" queue in the API boot.
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
] as const;

/** Roles considered "the committee" for notification fan-out. */
const COMMITTEE_NOTIFY_ROLES: MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
];

/** Distinct users holding any of the given active roles in the scheme. */
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
      ),
    );
  return rows.map((r) => r.userId);
}

async function allMemberUserIds(ctx: ServiceContext, schemeId: string): Promise<string[]> {
  const rows = await ctx.db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.schemeId, schemeId), isNull(memberships.endedOn)));
  return rows.map((r) => r.userId);
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
  return await ctx.db
    .selectDistinct({ schemeId: memberships.schemeId, userId: memberships.userId })
    .from(memberships)
    .innerJoin(schemes, eq(memberships.schemeId, schemes.id))
    .where(
      and(
        eq(schemes.organizationId, organizationId),
        eq(memberships.role, "manager_admin"),
        isNull(memberships.endedOn),
      ),
    );
}

/**
 * Org-scoped `compliance.obligation.due` (manager-level kinds: `pi_expiry`,
 * `registration_renewal`) carries no schemeId, so it can't ride the scheme
 * fan-out. Instead: bell every org admin in every scheme they administer under
 * the org, and email each admin once, linking to the manager back-office.
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

  // Bell: one row per (scheme, admin) pair, so the nudge shows wherever they work.
  const byScheme = new Map<string, string[]>();
  for (const t of targets) {
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

  // Email: once per distinct admin, best-effort (bell rows already exist).
  // Anchor each admin's CTA to a scheme they administer under this org.
  const anchorScheme = new Map<string, string>();
  for (const t of targets) {
    if (!anchorScheme.has(t.userId)) anchorScheme.set(t.userId, t.schemeId);
  }
  const userRows = await ctx.db.query.users.findMany({
    where: inArray(users.id, [...anchorScheme.keys()]),
  });
  for (const user of userRows) {
    if (!user.email) continue;
    const managerUrl = `${emailBrand.urls.app}/schemes/${anchorScheme.get(user.id)}/manager`;
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
      await ctx.integrations.email.send({ to: user.email, subject: title, text, html });
    } catch (err) {
      console.error(`[notifier] email to ${user.email} failed`, err);
    }
  }

  return { created };
}

/**
 * Handle one dispatched event. Returns how many notifications were created —
 * useful for logs and tests. Safe to call with any catalog event; unknown
 * types are a no-op.
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
      const body = "A decision needs your vote. Open the decision to review and respond.";
      const created = await notifyUsers(ctx, schemeId, committee, {
        title,
        body,
        category: "decision",
        related: { type: "decision", id: payload.decisionId },
      });

      // Email + SMS nudge, best-effort per recipient (in-app row already exists).
      const decisionsUrl = `${emailBrand.urls.app}/schemes/${schemeId}?section=decisions`;
      const { html, text } = renderEmail({
        preheader: `A decision needs your vote: ${payload.title}.`,
        heading: "A decision needs your vote",
        intro: `The committee has been asked to decide: ${payload.title}.`,
        blocks: [
          paragraph(
            "Open the decision in your inbox to review the details and record your vote. Your response is kept on the record.",
          ),
        ],
        cta: { label: "Review & vote", url: decisionsUrl },
      });
      const userRows = await ctx.db.query.users.findMany({
        where: inArray(users.id, committee),
      });
      for (const user of userRows) {
        if (!user.email) continue;
        try {
          await ctx.integrations.email.send({
            to: user.email,
            subject: title,
            text,
            html,
          });
        } catch (err) {
          console.error(`[notifier] email to ${user.email} failed`, err);
        }
      }
      const personRows = await ctx.db.query.people.findMany({
        where: and(eq(people.schemeId, schemeId), inArray(people.userId, committee)),
      });
      for (const person of personRows) {
        if (!person.phone) continue;
        try {
          await ctx.integrations.sms.send({
            to: person.phone,
            body: `GoodStrata: decision needs your vote — ${payload.title}`,
          });
        } catch (err) {
          console.error(`[notifier] sms to ${person.phone} failed`, err);
        }
      }
      return { created: created.length };
    }

    case "work_order.dispatched": {
      const payload = event.payload as { workOrderId: string };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const created = await notifyUsers(ctx, schemeId, committee, {
        title: "Work order dispatched",
        body: "A work order has been dispatched to a contractor.",
        category: "maintenance",
        related: { type: "work_order", id: payload.workOrderId },
      });
      return { created: created.length };
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
      const created = await notifyUsers(ctx, schemeId, userIds, {
        title: `Levy notice ${payload.noticeNumber} issued`,
        body: `${formatCents(payload.totalCents)} due ${payload.dueOn}${
          lotNumber ? ` for lot ${lotNumber}` : ""
        }.`,
        category: "finance",
        related: { type: "levy_notice", id: payload.levyNoticeId },
      });
      return { created: created.length };
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
      const created = await notifyUsers(ctx, schemeId, committee, {
        title: `Arrears escalated to stage ${payload.stage}`,
        body: `A lot is ${payload.daysOverdue} days overdue with ${formatCents(
          payload.outstandingCents,
        )} outstanding.`,
        category: "finance",
        related: { type: "lot", id: payload.lotId },
      });
      return { created: created.length };
    }

    case "minutes.drafted": {
      const payload = event.payload as { meetingId: string; documentId: string };
      const members = await allMemberUserIds(ctx, schemeId);
      const created = await notifyUsers(ctx, schemeId, members, {
        title: "Meeting minutes drafted",
        body: "Draft minutes are ready to review in the documents section.",
        category: "meeting",
        related: { type: "meeting", id: payload.meetingId },
      });
      return { created: created.length };
    }

    case "maintenance.request.created": {
      const payload = event.payload as { requestId: string; title: string };
      const committee = await userIdsWithRoles(ctx, schemeId, COMMITTEE_NOTIFY_ROLES);
      const created = await notifyUsers(ctx, schemeId, committee, {
        title: `New maintenance request: ${payload.title}`,
        body: "A new maintenance request has been lodged and needs triage.",
        category: "maintenance",
        related: { type: "maintenance_request", id: payload.requestId },
      });
      return { created: created.length };
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
      // Don't notify the author about their own comment.
      if (!post || post.authorUserId === payload.authorUserId) return { created: 0 };
      const created = await notifyUsers(ctx, schemeId, [post.authorUserId], {
        title: "New comment on your post",
        body: "Someone replied to your community board post.",
        category: "general",
        related: { type: "community_post", id: payload.postId },
      });
      return { created: created.length };
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
      const created = await notifyUsers(ctx, schemeId, recipients, {
        title: overdue
          ? `Overdue: ${payload.kind.replace(/_/g, " ")}`
          : `Compliance due ${payload.dueOn}: ${payload.kind.replace(/_/g, " ")}`,
        body: overdue
          ? `A compliance obligation is overdue (was due ${payload.dueOn}). Act to bring it back into compliance.`
          : `A compliance obligation is approaching its due date (${payload.dueOn}).`,
        category: "general",
        related: { type: "compliance_obligation", id: payload.obligationId },
      });
      return { created: created.length };
    }

    default:
      return { created: 0 };
  }
}
