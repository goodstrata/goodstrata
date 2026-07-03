/**
 * Single-scheme health snapshot: onboarding gaps, arrears + aging, pending
 * decisions with due dates, open work orders, and the next meeting.
 */
import {
  arrearsService,
  decisionsService,
  maintenanceService,
  meetingsService,
  onboardingService,
} from "@goodstrata/core";
import { formatCents } from "@goodstrata/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolContext } from "../server.js";
import {
  agingBuckets,
  cap,
  guard,
  isUpcoming,
  jsonResult,
  OPEN_WORK_ORDER_STATUSES,
} from "./helpers.js";

export function registerSchemeHealthTool(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "get_scheme_health",
    {
      title: "Scheme health",
      description:
        "A single scheme's operational health: onboarding gaps blocking activation, arrears with aging buckets, pending decisions with due dates, open work orders, and the next scheduled meeting.",
      inputSchema: { schemeId: z.string().describe("Scheme id from list_schemes") },
      annotations: { readOnlyHint: true },
    },
    ({ schemeId }) =>
      guard(async () => {
        ctx.requireScope("mcp:read");
        const { roles, ctx: svc } = await ctx.actor(schemeId);
        const now = svc.clock.now();

        const [onboarding, arrears, decisions, workOrders, meetings] = await Promise.all([
          onboardingService.onboardingStatus(svc, schemeId),
          arrearsService.arrearsForScheme(svc, schemeId),
          decisionsService.listDecisions(svc, schemeId, "pending"),
          maintenanceService.listWorkOrders(svc, schemeId),
          meetingsService.listMeetings(svc, schemeId),
        ]);

        const gaps: string[] = [];
        if (!onboarding.hasLots) gaps.push("no lots imported");
        if (!onboarding.hasInsurance) gaps.push("no current insurance certificate");

        const outstanding = arrears.reduce((a, x) => a + x.outstandingCents, 0);
        const openWorkOrders = workOrders.filter((w) =>
          OPEN_WORK_ORDER_STATUSES.includes(w.status),
        );
        const nextMeeting = meetings
          .filter((m) => isUpcoming(m, now))
          .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

        const data = {
          schemeId,
          roles,
          onboarding: {
            status: onboarding.status,
            ready: onboarding.ready,
            gaps,
          },
          arrears: {
            lotsInArrears: arrears.length,
            outstandingCents: outstanding,
            aging: agingBuckets(arrears),
            lots: cap(
              arrears.map((a) => ({
                lotId: a.lotId,
                lotNumber: a.lotNumber,
                outstandingCents: a.outstandingCents,
                daysOverdue: a.daysOverdue,
                stage: a.stage,
                interestAccruedCents: a.interestAccruedCents,
              })),
            ),
          },
          pendingDecisions: cap(
            decisions.map((d) => ({
              id: d.id,
              kind: d.kind,
              title: d.title,
              deciderRole: d.deciderRole,
              dueAt: d.dueAt,
              overdue: d.dueAt ? d.dueAt.getTime() < now.getTime() : false,
            })),
          ),
          openWorkOrders: cap(
            openWorkOrders.map((w) => ({
              id: w.id,
              scope: w.scope,
              status: w.status,
              approvedAmountCents: w.approvedAmountCents,
              scheduledFor: w.scheduledFor,
            })),
          ),
          nextMeeting: nextMeeting
            ? {
                id: nextMeeting.id,
                kind: nextMeeting.kind,
                title: nextMeeting.title,
                scheduledAt: nextMeeting.scheduledAt,
                status: nextMeeting.status,
              }
            : null,
        };

        const summary =
          `${onboarding.status}${gaps.length ? ` (gaps: ${gaps.join(", ")})` : ""}; ` +
          `${arrears.length} lot(s) in arrears (${formatCents(outstanding)}); ` +
          `${decisions.length} pending decision(s); ${openWorkOrders.length} open work order(s); ` +
          `next meeting: ${nextMeeting ? nextMeeting.scheduledAt.toISOString().slice(0, 10) : "none scheduled"}.`;
        return jsonResult(summary, data);
      }),
  );
}
