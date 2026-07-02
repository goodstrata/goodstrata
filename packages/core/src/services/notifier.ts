import { lots, memberships, ownerships, people, users } from "@goodstrata/db";
import type { EventRecord } from "@goodstrata/events";
import { formatCents, type MembershipRole } from "@goodstrata/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ServiceContext } from "../context.js";
import { notifyUsers } from "./notifications.js";

/**
 * The notifier: a pure-code event consumer (never an LLM) that turns domain
 * events into in-app notifications — and, for decision requests, an email/SMS
 * nudge to the committee. Wired to the "notify" queue in the API boot.
 */

export const NOTIFIER_EVENT_TYPES = [
  "decision.requested",
  "work_order.dispatched",
  "levy.notice.issued",
  "arrears.stage.reached",
  "minutes.drafted",
  "maintenance.request.created",
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
 * Handle one dispatched event. Returns how many notifications were created —
 * useful for logs and tests. Safe to call with any catalog event; unknown
 * types are a no-op.
 */
export async function handleEventForNotifications(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<{ created: number }> {
  const schemeId = event.schemeId;
  if (!schemeId) return { created: 0 };

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
      const userRows = await ctx.db.query.users.findMany({
        where: inArray(users.id, committee),
      });
      for (const user of userRows) {
        if (!user.email) continue;
        try {
          await ctx.integrations.email.send({
            to: user.email,
            subject: title,
            text: `${body}\n\nDecision: ${payload.title}`,
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

    default:
      return { created: 0 };
  }
}
