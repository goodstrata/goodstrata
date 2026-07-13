import {
  assets,
  documents,
  funds,
  maintenancePlanItems,
  schemes,
  statutoryMaintenancePlans,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { addMonthsDateOnly, isRealDateOnly, toDateOnly } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { raiseObligation } from "./compliance.js";
import { requireCarriedResolution } from "./resolutionValidation.js";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDateOnly);

export const createStatutoryMaintenancePlanInput = z.object({
  title: z.string().trim().min(3).max(200),
  approvedFormVersion: z.string().trim().min(1).max(100),
  preparedOn: dateOnly,
  coverageStartOn: dateOnly,
  sourceDocumentId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
});

export const createAssetInput = z.object({
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().min(2).max(100),
  location: z.string().trim().max(500).optional(),
  installedOn: dateOnly.optional(),
  warrantyUntil: dateOnly.optional(),
  expectedLifeYears: z.number().int().positive().max(200).optional(),
  replacementCostCents: z.number().int().nonnegative().optional(),
});

export const addMaintenancePlanItemInput = z.object({
  assetId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(200),
  presentCondition: z.enum(["good", "fair", "poor", "critical", "unknown"]),
  plannedAction: z.string().trim().min(3).max(2000),
  scheduledOn: dateOnly,
  estimatedCostCents: z.number().int().nonnegative(),
  expectedLifeAfterWorksYears: z.number().int().positive().max(200),
});

export const approveMaintenancePlanInput = z.object({
  approvalResolutionId: z.string().uuid(),
  approvedAtMeetingId: z.string().uuid(),
  approvedOn: dateOnly,
});

export const reviewMaintenancePlanInput = z.object({ reviewedOn: dateOnly });

async function schemeAndFund(ctx: ServiceContext, schemeId: string) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  const fund = await ctx.db.query.funds.findFirst({
    where: and(eq(funds.schemeId, schemeId), eq(funds.kind, "maintenance")),
  });
  if (!fund) throw new DomainError("NO_MAINTENANCE_FUND", "Create the maintenance fund first", 422);
  return { scheme, fund };
}

export async function listPlans(ctx: ServiceContext, schemeId: string) {
  const { scheme, fund } = await schemeAndFund(ctx, schemeId);
  const plans = await ctx.db.query.statutoryMaintenancePlans.findMany({
    where: eq(statutoryMaintenancePlans.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.preparedOn),
  });
  const result = await Promise.all(
    plans.map(async (plan) => {
      const items = await ctx.db.query.maintenancePlanItems.findMany({
        where: eq(maintenancePlanItems.planId, plan.id),
        orderBy: (t, { asc }) => asc(t.scheduledOn),
      });
      return {
        ...plan,
        items,
        forecastTotalCents: items.reduce((sum, item) => sum + item.estimatedCostCents, 0),
        completedCents: items
          .filter((item) => item.completedAt !== null)
          .reduce((sum, item) => sum + item.estimatedCostCents, 0),
      };
    }),
  );
  return {
    required: scheme.tier === 1 || scheme.tier === 2,
    fund: { id: fund.id, balanceCents: fund.balanceCents },
    plans: result,
  };
}

export async function listAssets(ctx: ServiceContext, schemeId: string) {
  await schemeAndFund(ctx, schemeId);
  return await ctx.db.query.assets.findMany({
    where: eq(assets.schemeId, schemeId),
    orderBy: (t, { asc }) => asc(t.name),
  });
}

export async function createAsset(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createAssetInput>,
) {
  await schemeAndFund(ctx, schemeId);
  const parsed = createAssetInput.parse(input);
  const rows = await ctx.db
    .insert(assets)
    .values({ ...parsed, schemeId })
    .returning();
  return rows[0]!;
}

export async function createPlan(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createStatutoryMaintenancePlanInput>,
) {
  const { fund } = await schemeAndFund(ctx, schemeId);
  const parsed = createStatutoryMaintenancePlanInput.parse(input);
  if (parsed.sourceDocumentId) {
    const source = await ctx.db.query.documents.findFirst({
      where: and(eq(documents.id, parsed.sourceDocumentId), eq(documents.schemeId, schemeId)),
    });
    if (!source) {
      throw new DomainError(
        "INVALID_PLAN_DOCUMENT",
        "Plan document must belong to this scheme",
        422,
      );
    }
  }
  const coverageEndOn = addMonthsDateOnly(parsed.coverageStartOn, 120);
  const rows = await ctx.db
    .insert(statutoryMaintenancePlans)
    .values({ ...parsed, schemeId, coverageEndOn, maintenanceFundId: fund.id })
    .returning();
  return rows[0]!;
}

export async function addPlanItem(
  ctx: ServiceContext,
  schemeId: string,
  planId: string,
  input: z.infer<typeof addMaintenancePlanItemInput>,
) {
  const parsed = addMaintenancePlanItemInput.parse(input);
  const plan = await ctx.db.query.statutoryMaintenancePlans.findFirst({
    where: and(
      eq(statutoryMaintenancePlans.id, planId),
      eq(statutoryMaintenancePlans.schemeId, schemeId),
    ),
  });
  if (!plan) throw notFound("Maintenance plan");
  if (plan.status !== "draft")
    throw new DomainError("PLAN_LOCKED", "Only a draft plan can be edited", 409);
  if (parsed.scheduledOn < plan.coverageStartOn || parsed.scheduledOn >= plan.coverageEndOn) {
    throw new DomainError(
      "OUTSIDE_PLAN_HORIZON",
      "Capital work must fall within the ten-year plan",
      422,
    );
  }
  if (parsed.assetId) {
    const asset = await ctx.db.query.assets.findFirst({
      where: and(eq(assets.id, parsed.assetId), eq(assets.schemeId, schemeId)),
    });
    if (!asset) throw notFound("Asset");
  }
  const rows = await ctx.db
    .insert(maintenancePlanItems)
    .values({ ...parsed, schemeId, planId })
    .returning();
  return rows[0]!;
}

export async function approvePlan(
  ctx: ServiceContext,
  schemeId: string,
  planId: string,
  input: z.infer<typeof approveMaintenancePlanInput>,
) {
  const parsed = approveMaintenancePlanInput.parse(input);
  const plan = await ctx.db.query.statutoryMaintenancePlans.findFirst({
    where: and(
      eq(statutoryMaintenancePlans.id, planId),
      eq(statutoryMaintenancePlans.schemeId, schemeId),
    ),
  });
  if (!plan) throw notFound("Maintenance plan");
  if (plan.status !== "draft")
    throw new DomainError("PLAN_NOT_DRAFT", "Plan has already been approved", 409);
  const items = await ctx.db.query.maintenancePlanItems.findMany({
    where: eq(maintenancePlanItems.planId, planId),
  });
  if (items.length === 0)
    throw new DomainError("PLAN_EMPTY", "Add at least one major capital item", 422);
  const authorisation = await requireCarriedResolution(ctx, schemeId, parsed.approvalResolutionId, {
    generalMeeting: true,
    minimum: "ordinary",
  });
  if (authorisation.meeting?.id !== parsed.approvedAtMeetingId) {
    throw new DomainError(
      "PLAN_MEETING_MISMATCH",
      "The approval meeting must match the carried resolution",
      422,
    );
  }
  const nextReviewOn = addMonthsDateOnly(parsed.approvedOn, 12);
  const approved = await ctx.db.transaction(async (tx) => {
    await tx
      .update(statutoryMaintenancePlans)
      .set({ status: "superseded" })
      .where(
        and(
          eq(statutoryMaintenancePlans.schemeId, schemeId),
          eq(statutoryMaintenancePlans.status, "approved"),
        ),
      );
    const rows = await tx
      .update(statutoryMaintenancePlans)
      .set({ ...parsed, status: "approved", lastReviewedOn: parsed.approvedOn, nextReviewOn })
      .where(eq(statutoryMaintenancePlans.id, planId))
      .returning();
    await publishEvent(tx, {
      schemeId,
      stream: `maintenance_plan:${planId}`,
      type: "maintenance.plan.approved",
      payload: {
        planId,
        approvalResolutionId: parsed.approvalResolutionId,
        itemCount: items.length,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });
  await raiseObligation(ctx, {
    schemeId,
    kind: "custom",
    title: "Annual maintenance plan review and AGM report",
    dueOn: nextReviewOn,
    subjectRef: `maintenance_plan:${planId}`,
    sourceRef: { planId },
    meta: { reportAtAgm: true },
  });
  return approved;
}

export async function reviewPlan(
  ctx: ServiceContext,
  schemeId: string,
  planId: string,
  input: z.infer<typeof reviewMaintenancePlanInput>,
) {
  const parsed = reviewMaintenancePlanInput.parse(input);
  const nextReviewOn = addMonthsDateOnly(parsed.reviewedOn, 12);
  const rows = await ctx.db
    .update(statutoryMaintenancePlans)
    .set({ status: "approved", lastReviewedOn: parsed.reviewedOn, nextReviewOn })
    .where(
      and(
        eq(statutoryMaintenancePlans.id, planId),
        eq(statutoryMaintenancePlans.schemeId, schemeId),
      ),
    )
    .returning();
  if (!rows[0]) throw notFound("Maintenance plan");
  return rows[0];
}

/** AGM-ready implementation summary for inclusion in meeting papers. */
export async function getAgmMaintenanceReport(ctx: ServiceContext, schemeId: string) {
  const data = await listPlans(ctx, schemeId);
  const plan = data.plans.find((p) => p.status === "approved") ?? null;
  return {
    required: data.required,
    plan,
    asOf: toDateOnly(ctx.clock.now()),
    maintenanceFundBalanceCents: data.fund.balanceCents,
    fundingGapCents: plan ? Math.max(0, plan.forecastTotalCents - data.fund.balanceCents) : 0,
  };
}
