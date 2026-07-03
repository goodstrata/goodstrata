/**
 * Single-scheme financial position: adopted budgets by fund, levy schedules,
 * issued notices, received payments, arrears aging, and a derived collection
 * rate. Member-level (matches the HTTP finance GET routes, which gate only on
 * membership, not officer tier).
 */
import { arrearsService, budgetsService, leviesService, paymentsService } from "@goodstrata/core";
import { formatCents } from "@goodstrata/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolContext } from "../server.js";
import { agingBuckets, cap, guard, jsonResult } from "./helpers.js";

export function registerFinancialPositionTool(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "get_financial_position",
    {
      title: "Financial position",
      description:
        "A single scheme's financial position: adopted budgets broken down by fund, levy schedules, issued levy notices, received payments, arrears aging, and the derived collection rate (received ÷ levied).",
      inputSchema: { schemeId: z.string().describe("Scheme id from list_schemes") },
      annotations: { readOnlyHint: true },
    },
    ({ schemeId }) =>
      guard(async () => {
        ctx.requireScope("mcp:read");
        const { roles, ctx: svc } = await ctx.actor(schemeId);

        const [budgets, schedules, notices, payments, arrears] = await Promise.all([
          budgetsService.listBudgets(svc, schemeId),
          leviesService.listSchedules(svc, schemeId),
          leviesService.listNotices(svc, schemeId),
          paymentsService.listPayments(svc, schemeId),
          arrearsService.arrearsForScheme(svc, schemeId),
        ]);

        // Adopted budgets, with per-fund breakdown from their lines.
        const adoptedBudgets = budgets
          .filter((b) => b.status === "adopted")
          .map((b) => {
            const byFund = { admin: 0, maintenance: 0 };
            for (const line of b.lines) {
              byFund[line.fundKind] = (byFund[line.fundKind] ?? 0) + line.amountCents;
            }
            return {
              budgetId: b.id,
              fiscalYearStart: b.fiscalYearStart,
              status: b.status,
              adminCents: byFund.admin,
              maintenanceCents: byFund.maintenance,
              totalCents: byFund.admin + byFund.maintenance,
            };
          });

        // Collection rate: total received ÷ total levied (by amount).
        const totalLeviedCents = notices.reduce((a, n) => a + n.totalCents, 0);
        const totalReceivedCents = payments
          .filter((p) => p.status === "matched" || p.status === "received")
          .reduce((a, p) => a + p.amountCents, 0);
        const collectionRate =
          totalLeviedCents > 0
            ? Math.round((totalReceivedCents / totalLeviedCents) * 1000) / 1000
            : null;
        const outstandingCents = arrears.reduce((a, x) => a + x.outstandingCents, 0);

        const data = {
          schemeId,
          roles,
          adoptedBudgets,
          levySchedules: cap(
            schedules.map((s) => ({
              id: s.id,
              budgetId: s.budgetId,
              frequency: s.frequency,
              instalments: s.instalments,
              firstDueOn: s.firstDueOn,
            })),
          ),
          levyNotices: {
            count: notices.length,
            totalLeviedCents,
            byStatus: notices.reduce<Record<string, number>>((acc, n) => {
              acc[n.status] = (acc[n.status] ?? 0) + 1;
              return acc;
            }, {}),
          },
          payments: {
            count: payments.length,
            totalReceivedCents,
          },
          arrears: {
            lotsInArrears: arrears.length,
            outstandingCents,
            aging: agingBuckets(arrears),
          },
          collectionRate,
        };

        const ratePct = collectionRate === null ? "n/a" : `${Math.round(collectionRate * 100)}%`;
        const summary =
          `${adoptedBudgets.length} adopted budget(s); levied ${formatCents(totalLeviedCents)} across ${notices.length} notice(s); ` +
          `received ${formatCents(totalReceivedCents)}; collection rate ${ratePct}; ` +
          `${arrears.length} lot(s) in arrears (${formatCents(outstandingCents)}).`;
        return jsonResult(summary, data);
      }),
  );
}
