import {
  arrearsService,
  budgetsService,
  complianceService,
  decisionsService,
  grievancesService,
  leviesService,
  lotsService,
  maintenanceService,
  meetingsService,
  onboardingService,
  peopleService,
  schemesService,
} from "@goodstrata/core";
import { eventLog } from "@goodstrata/db";
import { userActor } from "@goodstrata/shared";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import {
  isUpcoming,
  OPEN_MAINTENANCE_STATUSES,
  OPEN_WORK_ORDER_STATUSES,
} from "../mcp/tools/helpers.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";

/** Complaints still on the grievance clock (not resolved/withdrawn). */
const OPEN_COMPLAINT_STATUSES = [
  "received",
  "under_discussion",
  "notice_to_rectify",
  "final_notice",
  "vcat",
];

/** Roles allowed to see grievance figures — mirrors the grievances route guard. */
const GRIEVANCE_VIEWER_ROLES = ["chair", "secretary", "treasurer", "manager_admin"];

/**
 * Composed landing summary for an active scheme (P-overview). One read-only
 * round trip that mirrors the MCP `get_scheme_health` / `get_financial_position`
 * tools, reusing the same core services so the dashboard, the model, and the
 * finance tab all agree. Publishes nothing — every branch is a pure read.
 *
 * Membership-gated only, matching the finance/arrears/decisions GET routes it
 * summarises; the web layer decides which figures to foreground per role.
 */
export function overviewRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get("/:schemeId/overview", requireSchemeMember(deps), async (c) => {
    const schemeId = c.get("schemeId");
    const ctx = deps.serviceContext(userActor(c.get("user").id));
    const now = ctx.clock.now();

    // The dashboard composes many independent reads. A single failing section
    // (e.g. a sparse onboarding scheme with no budget/compliance data) must
    // degrade to empty, never 500 the whole overview — so each read is
    // fail-safe with its own fallback + a log for diagnosis.
    const safe = async <T>(p: Promise<T>, fallback: T, label: string): Promise<T> => {
      try {
        return await p;
      } catch (err) {
        console.error(`[overview] ${label} read failed`, err);
        return fallback;
      }
    };

    const scheme = await schemesService.getScheme(ctx, schemeId);

    // Grievance figures are officer-only (the complaints list route requires
    // chair/secretary/treasurer or manager_admin) — never read, let alone
    // return, the count for an ordinary member.
    const roles = c.get("roles") ?? [];
    const canSeeGrievances = roles.some((r) => GRIEVANCE_VIEWER_ROLES.includes(r));

    const [
      onboarding,
      lots,
      people,
      members,
      budgets,
      notices,
      arrears,
      pendingDecisions,
      requests,
      workOrders,
      meetings,
      obligations,
      complaints,
      events,
    ] = await Promise.all([
      safe(
        onboardingService.onboardingStatus(ctx, schemeId),
        {
          hasLots: false,
          hasInsurance: false,
          insuranceReasons: [],
          managerReady: false,
          managerReasons: [],
          ready: false,
          status: scheme.status,
        },
        "onboarding",
      ),
      safe(lotsService.listLots(ctx, schemeId), [], "lots"),
      safe(peopleService.listPeople(ctx, schemeId), [], "people"),
      safe(peopleService.listMembers(ctx, schemeId), [], "members"),
      safe(budgetsService.listBudgets(ctx, schemeId), [], "budgets"),
      safe(leviesService.listNotices(ctx, schemeId), [], "notices"),
      safe(arrearsService.arrearsForScheme(ctx, schemeId), [], "arrears"),
      safe(decisionsService.listDecisions(ctx, schemeId, "pending"), [], "decisions"),
      safe(maintenanceService.listRequests(ctx, schemeId), [], "maintenance"),
      safe(maintenanceService.listWorkOrders(ctx, schemeId), [], "workOrders"),
      safe(meetingsService.listMeetings(ctx, schemeId), [], "meetings"),
      safe(complianceService.listObligations(ctx, { schemeId, window: "open" }), [], "compliance"),
      canSeeGrievances
        ? safe(grievancesService.listComplaints(ctx, schemeId), [], "grievances")
        : Promise.resolve([]),
      safe(
        deps.db
          .select({
            id: eventLog.id,
            seq: eventLog.seq,
            type: eventLog.type,
            actor: eventLog.actor,
            occurredAt: eventLog.occurredAt,
          })
          .from(eventLog)
          .where(eq(eventLog.schemeId, schemeId))
          .orderBy(desc(eventLog.seq))
          .limit(8),
        [],
        "events",
      ),
    ]);

    // Finance — the "current" budget matches the finance tab: latest adopted,
    // else latest drafted, so the fund figures never contradict each other.
    const adopted = budgets.filter((b) => b.status === "adopted");
    const pool = adopted.length > 0 ? adopted : budgets;
    const current =
      pool.length > 0
        ? [...pool].sort((a, b) => b.fiscalYearStart.localeCompare(a.fiscalYearStart))[0]
        : undefined;
    let adminCents = 0;
    let maintenanceCents = 0;
    for (const line of current?.lines ?? []) {
      if (line.fundKind === "admin") adminCents += line.amountCents;
      else if (line.fundKind === "maintenance") maintenanceCents += line.amountCents;
    }
    const leviedCents = notices.reduce((sum, n) => sum + n.totalCents, 0);
    const arrearsOutstandingCents = arrears.reduce((sum, a) => sum + a.outstandingCents, 0);
    const arrearsInterestCents = arrears.reduce((sum, a) => sum + a.interestAccruedCents, 0);

    // Needs attention.
    const overdueDecisions = pendingDecisions.filter(
      (d) => d.dueAt !== null && d.dueAt.getTime() < now.getTime(),
    ).length;
    const openMaintenanceRequests = requests.filter((r) =>
      OPEN_MAINTENANCE_STATUSES.includes(r.status),
    ).length;
    const openWorkOrders = workOrders.filter((w) =>
      OPEN_WORK_ORDER_STATUSES.includes(w.status),
    ).length;
    const complianceOverdue = obligations.filter((o) => o.status === "overdue").length;
    const nextCompliance = obligations[0]; // service returns them ordered by dueOn asc
    const openGrievances = canSeeGrievances
      ? complaints.filter((g) => OPEN_COMPLAINT_STATUSES.includes(g.status)).length
      : null;

    // The meeting to surface: one that is happening right now beats the soonest
    // upcoming — a meeting must not vanish from the landing page the moment the
    // chair opens it (its scheduledAt is then in the past). Bounded to the last
    // 24 hours so a meeting left un-closed weeks ago cannot pin the card.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const inProgressMeeting = meetings
      .filter((m) => m.status === "in_progress" && now.getTime() - m.scheduledAt.getTime() < DAY_MS)
      .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0];
    const nextMeeting =
      inProgressMeeting ??
      meetings
        .filter((m) => isUpcoming(m, now))
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

    return c.json({
      scheme: {
        id: scheme.id,
        name: scheme.name,
        planOfSubdivision: scheme.planOfSubdivision,
        tier: scheme.tier,
        status: scheme.status,
      },
      onboarding: {
        hasLots: onboarding.hasLots,
        hasInsurance: onboarding.hasInsurance,
        ready: onboarding.ready,
        status: onboarding.status,
      },
      glance: {
        lots: lots.length,
        people: people.length,
        members: members.length,
      },
      finance: {
        hasBudget: current !== undefined,
        fiscalYearStart: current?.fiscalYearStart ?? null,
        adminCents,
        maintenanceCents,
        leviedCents,
        noticeCount: notices.length,
        arrearsCents: arrearsOutstandingCents + arrearsInterestCents,
        arrearsOutstandingCents,
        lotsInArrears: arrears.length,
      },
      attention: {
        pendingDecisions: pendingDecisions.length,
        overdueDecisions,
        openMaintenanceRequests,
        openWorkOrders,
        complianceOpen: obligations.length,
        complianceOverdue,
        // null = caller may not see grievance figures (not an officer).
        openGrievances,
        nextCompliance: nextCompliance
          ? {
              id: nextCompliance.id,
              kind: nextCompliance.kind,
              title: nextCompliance.title,
              dueOn: nextCompliance.dueOn,
              status: nextCompliance.status,
            }
          : null,
      },
      nextMeeting: nextMeeting
        ? {
            id: nextMeeting.id,
            kind: nextMeeting.kind,
            title: nextMeeting.title,
            scheduledAt: nextMeeting.scheduledAt.toISOString(),
            status: nextMeeting.status,
          }
        : null,
      recentActivity: events.map((e) => ({
        id: e.id,
        seq: e.seq,
        type: e.type,
        actor: e.actor as { kind: string; id: string },
        occurredAt: e.occurredAt.toISOString(),
      })),
    });
  });
}
