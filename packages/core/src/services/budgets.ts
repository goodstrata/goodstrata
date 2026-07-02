import { budgetLines, budgets } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { formatCents } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { registerDecisionAction, requestDecision } from "./decisions.js";

export const createBudgetInput = z.object({
  fiscalYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adminCents: z.number().int().positive(),
  maintenanceCents: z.number().int().nonnegative(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetInput>;

/**
 * Draft a budget and open the committee adoption gate (SPEC §2.1: budgets are
 * a human decision; the system prepares everything).
 */
export async function createBudget(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateBudgetInput,
) {
  const budget = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(budgets)
      .values({
        schemeId,
        fiscalYearStart: input.fiscalYearStart,
        status: "committee_review",
      })
      .returning();
    const budget = rows[0]!;

    await tx.insert(budgetLines).values([
      {
        budgetId: budget.id,
        fundKind: "admin",
        category: "general",
        description: "Administration fund",
        amountCents: input.adminCents,
      },
      {
        budgetId: budget.id,
        fundKind: "maintenance",
        category: "general",
        description: "Maintenance fund",
        amountCents: input.maintenanceCents,
      },
    ]);

    await publishEvent(tx, {
      schemeId,
      stream: `budget:${budget.id}`,
      type: "budget.drafted",
      payload: {
        budgetId: budget.id,
        fiscalYearStart: input.fiscalYearStart,
        totalCents: input.adminCents + input.maintenanceCents,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return budget;
  });

  const decision = await requestDecision(ctx, {
    schemeId,
    kind: "budget_adoption",
    title: `Adopt FY budget starting ${input.fiscalYearStart}`,
    summaryMd: [
      `Proposed budget for the year starting **${input.fiscalYearStart}**:`,
      "",
      `- Administration fund: **${formatCents(input.adminCents)}**`,
      `- Maintenance fund: **${formatCents(input.maintenanceCents)}**`,
      `- Total: **${formatCents(input.adminCents + input.maintenanceCents)}**`,
      "",
      "On approval the budget becomes active and levy schedules can be issued against it.",
    ].join("\n"),
    subject: { type: "budget", id: budget.id },
    deciderRole: "treasurer",
    followUp: { type: "action", action: "finance.adoptBudget", args: { budgetId: budget.id } },
  });

  await ctx.db.update(budgets).set({ decisionId: decision.id }).where(eq(budgets.id, budget.id));

  return { ...budget, decisionId: decision.id };
}

export async function listBudgets(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.budgets.findMany({
    where: eq(budgets.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.fiscalYearStart),
  });
  const lines = await ctx.db.query.budgetLines.findMany();
  return rows.map((b) => ({
    ...b,
    lines: lines.filter((l) => l.budgetId === b.id),
  }));
}

export async function getAdoptedBudgetFunds(
  ctx: ServiceContext,
  schemeId: string,
  budgetId: string,
) {
  const budget = await ctx.db.query.budgets.findFirst({
    where: and(eq(budgets.id, budgetId), eq(budgets.schemeId, schemeId)),
  });
  if (!budget) throw notFound("Budget");
  if (budget.status !== "adopted") {
    throw new DomainError("BUDGET_NOT_ADOPTED", "Budget must be adopted before levies issue", 422);
  }
  const lines = await ctx.db.query.budgetLines.findMany({
    where: eq(budgetLines.budgetId, budgetId),
  });
  const byFund = new Map<"admin" | "maintenance", number>();
  for (const line of lines) {
    byFund.set(line.fundKind, (byFund.get(line.fundKind) ?? 0) + line.amountCents);
  }
  return [...byFund.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([fundKind, annualCents]) => ({ fundKind, annualCents }));
}

// Executor action: the treasurer approved — code flips the state.
registerDecisionAction("finance.adoptBudget", async (ctx, args) => {
  const budgetId = z.object({ budgetId: z.string() }).parse(args).budgetId;
  const budget = await ctx.db.query.budgets.findFirst({ where: eq(budgets.id, budgetId) });
  if (!budget || budget.status === "adopted") return; // idempotent
  await ctx.db.transaction(async (tx) => {
    await tx.update(budgets).set({ status: "adopted" }).where(eq(budgets.id, budgetId));
    await publishEvent(tx, {
      schemeId: budget.schemeId,
      stream: `budget:${budgetId}`,
      type: "budget.adopted",
      payload: { budgetId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
});
