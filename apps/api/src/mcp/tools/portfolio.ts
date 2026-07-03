/**
 * Cross-scheme composite read tools. Both walk every scheme the caller belongs
 * to (membership + roles come from listSchemesForUser, so no extra role query)
 * and fan out to the domain services, capping every inner list.
 */
import {
  arrearsService,
  decisionsService,
  maintenanceService,
  meetingsService,
  notificationsService,
  schemesService,
} from "@goodstrata/core";
import { formatCents, type MembershipRole, userActor } from "@goodstrata/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolContext } from "../server.js";
import {
  canDecide,
  cap,
  guard,
  isUpcoming,
  jsonResult,
  OPEN_MAINTENANCE_STATUSES,
} from "./helpers.js";

export function registerPortfolioTools(server: McpServer, ctx: McpToolContext): void {
  // ── get_portfolio_briefing ────────────────────────────────────────────────
  server.registerTool(
    "get_portfolio_briefing",
    {
      title: "Portfolio briefing",
      description:
        "A one-shot briefing across ALL the caller's schemes: lots in arrears, pending decisions the caller can act on, open maintenance, upcoming meetings, and unread notices — rolled up and per scheme.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        ctx.requireScope("mcp:read");
        const userId = ctx.auth.userId;
        const svc = ctx.deps.serviceContext(userActor(userId));
        const now = svc.clock.now();
        const memberships = await schemesService.listSchemesForUser(svc, userId);

        const perScheme = [];
        const totals = {
          schemes: memberships.length,
          lotsInArrears: 0,
          arrearsOutstandingCents: 0,
          actionableDecisions: 0,
          openMaintenance: 0,
          upcomingMeetings: 0,
          unreadNotices: 0,
        };

        for (const { scheme, roles } of memberships) {
          const memberRoles = roles as MembershipRole[];
          const [arrears, decisions, requests, meetings, notices] = await Promise.all([
            arrearsService.arrearsForScheme(svc, scheme.id),
            decisionsService.listDecisions(svc, scheme.id, "pending"),
            maintenanceService.listRequests(svc, scheme.id),
            meetingsService.listMeetings(svc, scheme.id),
            notificationsService.listNotifications(svc, scheme.id, userId, { unreadOnly: true }),
          ]);

          const actionable = decisions.filter((d) => canDecide(memberRoles, d.deciderRole));
          const openMaint = requests.filter((r) => OPEN_MAINTENANCE_STATUSES.includes(r.status));
          const upcoming = meetings.filter((m) => isUpcoming(m, now));
          const outstanding = arrears.reduce((a, x) => a + x.outstandingCents, 0);

          totals.lotsInArrears += arrears.length;
          totals.arrearsOutstandingCents += outstanding;
          totals.actionableDecisions += actionable.length;
          totals.openMaintenance += openMaint.length;
          totals.upcomingMeetings += upcoming.length;
          totals.unreadNotices += notices.length;

          perScheme.push({
            schemeId: scheme.id,
            name: scheme.name,
            roles: memberRoles,
            arrears: {
              lotsInArrears: arrears.length,
              outstandingCents: outstanding,
            },
            actionableDecisions: cap(
              actionable.map((d) => ({
                id: d.id,
                kind: d.kind,
                title: d.title,
                deciderRole: d.deciderRole,
                dueAt: d.dueAt,
              })),
            ),
            openMaintenance: cap(
              openMaint.map((r) => ({
                id: r.id,
                title: r.title,
                status: r.status,
                urgency: r.urgency,
              })),
            ),
            upcomingMeetings: cap(
              upcoming.map((m) => ({
                id: m.id,
                kind: m.kind,
                title: m.title,
                scheduledAt: m.scheduledAt,
                status: m.status,
              })),
            ),
            unreadNotices: notices.length,
          });
        }

        const summary =
          `${totals.schemes} scheme(s): ${totals.lotsInArrears} lot(s) in arrears ` +
          `(${formatCents(totals.arrearsOutstandingCents)}), ${totals.actionableDecisions} decision(s) need you, ` +
          `${totals.openMaintenance} open maintenance, ${totals.upcomingMeetings} upcoming meeting(s), ` +
          `${totals.unreadNotices} unread notice(s).`;
        return jsonResult(summary, { totals, schemes: perScheme });
      }),
  );

  // ── find_my_pending_actions ───────────────────────────────────────────────
  // Role-aware: only decisions the caller's tier is eligible to decide, across
  // every scheme, soonest-due first, overdue flagged.
  server.registerTool(
    "find_my_pending_actions",
    {
      title: "Find my pending actions",
      description:
        "Answer 'what needs me?' — the pending decisions across all the caller's schemes that the caller's role tier is eligible to decide (treasurer / committee / all-owners), sorted soonest-due first with overdue flagged.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        ctx.requireScope("mcp:read");
        const userId = ctx.auth.userId;
        const svc = ctx.deps.serviceContext(userActor(userId));
        const now = svc.clock.now();
        const memberships = await schemesService.listSchemesForUser(svc, userId);

        const actions = [];
        for (const { scheme, roles } of memberships) {
          const memberRoles = roles as MembershipRole[];
          const decisions = await decisionsService.listDecisions(svc, scheme.id, "pending");
          for (const d of decisions) {
            if (!canDecide(memberRoles, d.deciderRole)) continue;
            actions.push({
              schemeId: scheme.id,
              schemeName: scheme.name,
              decisionId: d.id,
              kind: d.kind,
              title: d.title,
              deciderRole: d.deciderRole,
              dueAt: d.dueAt,
              overdue: d.dueAt ? d.dueAt.getTime() < now.getTime() : false,
              yourRoles: memberRoles,
            });
          }
        }

        // Soonest-due first; decisions without a due date sort last.
        actions.sort((a, b) => {
          const at = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
          const bt = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
          return at - bt;
        });

        const overdue = actions.filter((a) => a.overdue).length;
        const summary =
          actions.length === 0
            ? "Nothing needs you right now — no pending decisions in your tier."
            : `${actions.length} decision(s) need you${overdue ? `, ${overdue} overdue` : ""}.`;
        return jsonResult(summary, { count: actions.length, overdue, ...cap(actions) });
      }),
  );
}
