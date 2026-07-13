import { budgetLines, budgets } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { formatCents } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { registerDecisionAction, requestDecision } from "./decisions.js";
import { requireCarriedResolution } from "./resolutionValidation.js";

export const createBudgetInput = z.object({
  fiscalYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adminCents: z.number().int().positive(),
  maintenanceCents: z.number().int().nonnegative(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetInput>;

/**
 * Draft a budget and open the committee proposal gate. This is deliberately
 * not statutory adoption: owners adopt the budget through a carried motion at
 * an AGM/SGM, recorded by `adoptBudget` below.
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
    title: `Approve proposed FY budget starting ${input.fiscalYearStart}`,
    summaryMd: [
      `Proposed budget for the year starting **${input.fiscalYearStart}**:`,
      "",
      `- Administration fund: **${formatCents(input.adminCents)}**`,
      `- Maintenance fund: **${formatCents(input.maintenanceCents)}**`,
      `- Total: **${formatCents(input.adminCents + input.maintenanceCents)}**`,
      "",
      "Approval tables the proposal for an owners' resolution. It does not adopt the budget or authorise levies.",
    ].join("\n"),
    subject: { type: "budget", id: budget.id },
    deciderRole: "treasurer",
    followUp: {
      type: "action",
      action: "finance.approveBudgetProposal",
      args: { budgetId: budget.id },
    },
  });

  await ctx.db.update(budgets).set({ decisionId: decision.id }).where(eq(budgets.id, budget.id));

  return { ...budget, decisionId: decision.id };
}

export const adoptBudgetInput = z.object({
  motionId: z.string().uuid(),
});

/** Adopt a budget only against a carried AGM/SGM resolution record. */
export async function adoptBudget(
  ctx: ServiceContext,
  schemeId: string,
  budgetId: string,
  motionId: string,
) {
  const budget = await ctx.db.query.budgets.findFirst({
    where: and(eq(budgets.id, budgetId), eq(budgets.schemeId, schemeId)),
  });
  if (!budget) throw notFound("Budget");
  if (budget.status === "adopted") {
    if (budget.adoptedByMotionId === motionId) return budget;
    throw new DomainError("BUDGET_ALREADY_ADOPTED", "Budget is already adopted", 409);
  }

  const { meeting } = await requireCarriedResolution(ctx, schemeId, motionId, {
    generalMeeting: true,
    minimum: "ordinary",
  });

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(budgets)
      .set({
        status: "adopted",
        adoptedAtMeetingId: meeting!.id,
        adoptedByMotionId: motionId,
      })
      .where(and(eq(budgets.id, budgetId), eq(budgets.schemeId, schemeId)))
      .returning();
    await publishEvent(tx, {
      schemeId,
      stream: `budget:${budgetId}`,
      type: "budget.adopted",
      payload: { budgetId, meetingId: meeting!.id, motionId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });
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

// Internal proposal approval. Statutory adoption remains resolution-gated.
registerDecisionAction("finance.approveBudgetProposal", async (ctx, args) => {
  const budgetId = z.object({ budgetId: z.string() }).parse(args).budgetId;
  const budget = await ctx.db.query.budgets.findFirst({ where: eq(budgets.id, budgetId) });
  if (!budget) return;
  // Intentionally no budget state transition: the carried owners' motion is
  // the only code path that can set status=adopted.
});
