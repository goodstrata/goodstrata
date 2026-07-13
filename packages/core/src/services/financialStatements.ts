import {
  complianceObligations,
  documents,
  financialStatementReviews,
  financialStatements,
  funds,
  fundTransactions,
  invoices,
  lotLedgerEntries,
  lots,
  meetings,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  buildFinancialStatementPdf,
  type FinancialStatementDoc,
} from "@goodstrata/integrations/pdf";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { completeObligation } from "./compliance.js";
import { uploadDocument } from "./documents.js";

export const prepareFinancialStatementInput = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accountingBasis: z
      .enum(["general_purpose_accrual", "special_purpose_accrual"])
      .default("special_purpose_accrual"),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "Period end must not precede period start",
    path: ["periodEnd"],
  });

export const recordFinancialReviewInput = z.object({
  kind: z.enum(["audit", "independent_review"]),
  reviewerName: z.string().trim().min(2).max(200),
  reviewerOrganisation: z.string().trim().max(200).optional(),
  professionalBody: z.enum(["ASIC", "CPA Australia", "IPA", "CA ANZ", "CAV approved"]),
  membershipNumber: z.string().trim().max(100).optional(),
  independentDeclaration: z.string().trim().min(20).max(2000),
  outcome: z.enum(["unmodified", "qualified", "adverse", "disclaimer"]),
  reportDocumentId: z.string().uuid(),
  completedAt: z.string().datetime(),
});

export const presentFinancialStatementInput = z.object({ meetingId: z.string().uuid() });

function schemeParty(scheme: typeof schemes.$inferSelect): FinancialStatementDoc["scheme"] {
  return {
    name: scheme.name,
    planOfSubdivision: scheme.planOfSubdivision,
    addressLine1: scheme.addressLine1,
    addressLine2: scheme.addressLine2,
    suburb: scheme.suburb,
    state: scheme.state,
    postcode: scheme.postcode,
    abn: scheme.abn,
    gstRegistered: scheme.gstRegistered,
  };
}

/** Tier 1 = audit, Tier 2 = independent review; two-lot OCs are exempt. */
export async function requiredReviewKind(ctx: ServiceContext, schemeId: string) {
  const [scheme, lotRows] = await Promise.all([
    ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) }),
    ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) }),
  ]);
  if (!scheme) throw notFound("Scheme");
  if (lotRows.length === 2) return null;
  if (scheme.tier === 1) return "audit" as const;
  if (scheme.tier === 2) return "independent_review" as const;
  return null;
}

/**
 * Prepare an immutable annual statement snapshot from the ledgers and store a
 * seven-year financial document. The report is deliberately labelled by its
 * accounting basis; professional review is a separate, evidenced workflow.
 */
export async function prepareFinancialStatement(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof prepareFinancialStatementInput>,
) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  const existing = await ctx.db.query.financialStatements.findFirst({
    where: and(
      eq(financialStatements.schemeId, schemeId),
      eq(financialStatements.periodStart, input.periodStart),
      eq(financialStatements.periodEnd, input.periodEnd),
    ),
  });
  if (existing) {
    throw new DomainError(
      "FINANCIAL_STATEMENT_EXISTS",
      "A financial statement already exists for this period",
      409,
    );
  }

  const from = new Date(`${input.periodStart}T00:00:00.000Z`);
  const to = new Date(`${input.periodEnd}T23:59:59.999Z`);
  const [cashFlows, cashRows, receivableRows, liabilityRows, interestRows] = await Promise.all([
    ctx.db.query.fundTransactions.findMany({
      where: and(
        eq(fundTransactions.schemeId, schemeId),
        gte(fundTransactions.occurredAt, from),
        lte(fundTransactions.occurredAt, to),
      ),
    }),
    ctx.db
      .select({ total: sql<string>`coalesce(sum(${funds.balanceCents}), 0)` })
      .from(funds)
      .where(eq(funds.schemeId, schemeId)),
    ctx.db
      .select({ total: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}), 0)` })
      .from(lotLedgerEntries)
      .where(eq(lotLedgerEntries.schemeId, schemeId)),
    ctx.db
      .select({ total: sql<string>`coalesce(sum(${invoices.amountCents}), 0)` })
      .from(invoices)
      .where(
        and(
          eq(invoices.schemeId, schemeId),
          inArray(invoices.status, [
            "received",
            "matched",
            "pending_approval",
            "approved",
            "scheduled",
            "disputed",
          ]),
        ),
      ),
    ctx.db
      .select({ total: sql<string>`coalesce(sum(${lotLedgerEntries.amountCents}), 0)` })
      .from(lotLedgerEntries)
      .where(
        and(
          eq(lotLedgerEntries.schemeId, schemeId),
          eq(lotLedgerEntries.kind, "interest"),
          gte(lotLedgerEntries.effectiveOn, input.periodStart),
          lte(lotLedgerEntries.effectiveOn, input.periodEnd),
        ),
      ),
  ]);
  const incomeCents = cashFlows.reduce(
    (sum, row) => sum + (row.amountCents > 0 ? row.amountCents : 0),
    0,
  );
  const expenditureCents = cashFlows.reduce(
    (sum, row) => sum + (row.amountCents < 0 ? -row.amountCents : 0),
    0,
  );
  const cashCents = Number(cashRows[0]?.total ?? 0);
  const receivablesCents = Math.max(0, Number(receivableRows[0]?.total ?? 0));
  const liabilitiesCents = Number(liabilityRows[0]?.total ?? 0);
  const penaltyInterestCents = Number(interestRows[0]?.total ?? 0);
  const netAssetsCents = cashCents + receivablesCents - liabilitiesCents;
  const figures = {
    incomeCents,
    expenditureCents,
    cashCents,
    receivablesCents,
    liabilitiesCents,
    penaltyInterestCents,
    netAssetsCents,
  };

  const pdf = await buildFinancialStatementPdf({
    scheme: schemeParty(scheme),
    statement: { ...input, ...figures },
  });
  const doc = await uploadDocument(ctx, schemeId, {
    filename: `Annual-Financial-Statements-${input.periodEnd}.pdf`,
    contentType: "application/pdf",
    content: new Uint8Array(pdf),
    category: "financial",
    accessLevel: "owners",
    title: `Annual financial statements ${input.periodStart} to ${input.periodEnd}`,
  });
  const reviewRequirement = await requiredReviewKind(ctx, schemeId);

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(financialStatements)
      .values({
        schemeId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        accountingBasis: input.accountingBasis,
        figures,
        documentId: doc.id,
        preparedAt: ctx.clock.now(),
      })
      .returning();
    const statement = rows[0]!;
    await publishEvent(tx, {
      schemeId,
      stream: `financial_statement:${statement.id}`,
      type: "finance.statement.prepared",
      payload: {
        financialStatementId: statement.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        documentId: doc.id,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return { ...statement, requiredReviewKind: reviewRequirement };
  });
}

export async function listFinancialStatements(ctx: ServiceContext, schemeId: string) {
  const rows = await ctx.db.query.financialStatements.findMany({
    where: eq(financialStatements.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.periodEnd),
  });
  const reviews = await ctx.db.query.financialStatementReviews.findMany({
    where: eq(financialStatementReviews.schemeId, schemeId),
  });
  const requirement = await requiredReviewKind(ctx, schemeId);
  return rows.map((row) => ({
    ...row,
    requiredReviewKind: requirement,
    review: reviews.find((review) => review.financialStatementId === row.id) ?? null,
  }));
}

export async function recordFinancialReview(
  ctx: ServiceContext,
  schemeId: string,
  statementId: string,
  input: z.infer<typeof recordFinancialReviewInput>,
) {
  const statement = await ctx.db.query.financialStatements.findFirst({
    where: and(eq(financialStatements.id, statementId), eq(financialStatements.schemeId, schemeId)),
  });
  if (!statement) throw notFound("Financial statement");
  const report = await ctx.db.query.documents.findFirst({
    where: and(eq(documents.id, input.reportDocumentId), eq(documents.schemeId, schemeId)),
  });
  if (report?.category !== "financial") {
    throw new DomainError(
      "INVALID_REVIEW_REPORT",
      "The audit or review report must be a financial document in this scheme",
      422,
    );
  }
  const required = await requiredReviewKind(ctx, schemeId);
  if (required && input.kind !== required) {
    throw new DomainError(
      "WRONG_REVIEW_KIND",
      `This owners corporation requires an ${required.replaceAll("_", " ")}`,
      422,
    );
  }
  if (
    input.kind === "audit" &&
    !["ASIC", "CPA Australia", "IPA", "CA ANZ", "CAV approved"].includes(input.professionalBody)
  ) {
    throw new DomainError(
      "AUDITOR_NOT_ELIGIBLE",
      "The auditor's professional authority is not recognised",
      422,
    );
  }
  if (
    input.kind === "independent_review" &&
    !["CPA Australia", "IPA", "CA ANZ"].includes(input.professionalBody)
  ) {
    throw new DomainError(
      "REVIEWER_NOT_ELIGIBLE",
      "Tier 2 reviews require a CPA, IPA or CA ANZ member",
      422,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const existing = await tx.query.financialStatementReviews.findFirst({
      where: eq(financialStatementReviews.financialStatementId, statementId),
    });
    if (existing) throw new DomainError("REVIEW_EXISTS", "A review is already recorded", 409);
    const rows = await tx
      .insert(financialStatementReviews)
      .values({
        schemeId,
        financialStatementId: statementId,
        ...input,
        reviewerOrganisation: input.reviewerOrganisation ?? null,
        membershipNumber: input.membershipNumber ?? null,
        completedAt: new Date(input.completedAt),
      })
      .returning();
    await tx
      .update(financialStatements)
      .set({ status: "reviewed" })
      .where(eq(financialStatements.id, statementId));
    await publishEvent(tx, {
      schemeId,
      stream: `financial_statement:${statementId}`,
      type: "finance.statement.reviewed",
      payload: { financialStatementId: statementId, reviewId: rows[0]!.id, kind: input.kind },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });
}

export async function presentFinancialStatement(
  ctx: ServiceContext,
  schemeId: string,
  statementId: string,
  meetingId: string,
) {
  const [statement, meeting] = await Promise.all([
    ctx.db.query.financialStatements.findFirst({
      where: and(
        eq(financialStatements.id, statementId),
        eq(financialStatements.schemeId, schemeId),
      ),
    }),
    ctx.db.query.meetings.findFirst({
      where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
    }),
  ]);
  if (!statement) throw notFound("Financial statement");
  if (!meeting) throw notFound("Meeting");
  if (meeting.kind !== "agm") {
    throw new DomainError(
      "AGM_REQUIRED",
      "Annual financial statements must be presented at an AGM",
      422,
    );
  }
  if (!["closed", "minutes_draft", "minutes_distributed"].includes(meeting.status)) {
    throw new DomainError(
      "MEETING_NOT_COMPLETED",
      "The AGM must be completed before presentation is recorded",
      422,
    );
  }
  const requirement = await requiredReviewKind(ctx, schemeId);
  if (requirement) {
    const review = await ctx.db.query.financialStatementReviews.findFirst({
      where: eq(financialStatementReviews.financialStatementId, statementId),
    });
    if (!review || review.kind !== requirement) {
      throw new DomainError(
        "REVIEW_REQUIRED",
        `A ${requirement.replaceAll("_", " ")} report must accompany the statements`,
        422,
      );
    }
  }
  const presented = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(financialStatements)
      .set({
        status: "presented",
        presentedAtMeetingId: meetingId,
        presentedAt: ctx.clock.now(),
      })
      .where(eq(financialStatements.id, statementId))
      .returning();
    await publishEvent(tx, {
      schemeId,
      stream: `financial_statement:${statementId}`,
      type: "finance.statement.presented",
      payload: { financialStatementId: statementId, meetingId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return rows[0]!;
  });
  const obligation = await ctx.db.query.complianceObligations.findFirst({
    where: and(
      eq(complianceObligations.schemeId, schemeId),
      eq(complianceObligations.kind, "financial_statements"),
      inArray(complianceObligations.status, ["upcoming", "due", "overdue"]),
    ),
    orderBy: (t, { asc }) => asc(t.dueOn),
  });
  if (obligation) await completeObligation(ctx, obligation.id);
  return presented;
}
