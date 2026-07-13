import {
  documents,
  insuranceClaims,
  insurancePolicies,
  insuranceValuations,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { addMonthsDateOnly, isRealDateOnly, toDateOnly } from "@goodstrata/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { raiseObligation } from "./compliance.js";

export const MIN_PUBLIC_LIABILITY_CENTS = 2_000_000_000;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDateOnly, "Must be a real calendar date");

export const recordInsurancePolicyInput = z
  .object({
    kind: z.enum([
      "building",
      "public_liability",
      "office_bearers",
      "fidelity",
      "machinery",
      "voluntary_workers",
    ]),
    insurer: z.string().trim().min(1).max(200),
    policyNumber: z.string().trim().min(1).max(100),
    sumInsuredCents: z.number().int().positive().optional(),
    excessCents: z.number().int().nonnegative().optional(),
    premiumCents: z.number().int().nonnegative().optional(),
    periodStart: dateOnly,
    periodEnd: dateOnly,
    reinstatementAndReplacement: z.boolean().optional(),
    certificateDocumentId: z.string().uuid(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    path: ["periodEnd"],
    message: "Policy end must be on or after its start",
  })
  .refine((v) => v.kind !== "building" || v.reinstatementAndReplacement === true, {
    path: ["reinstatementAndReplacement"],
    message: "Building cover must include reinstatement and replacement",
  });

export const recordInsuranceValuationInput = z.object({
  valuerName: z.string().trim().min(1).max(200),
  valuedOn: dateOnly,
  replacementValueCents: z.number().int().positive(),
  reportDocumentId: z.string().uuid(),
  presentedAtMeetingId: z.string().uuid().optional(),
});

export const createInsuranceClaimInput = z.object({
  policyId: z.string().uuid(),
  description: z.string().trim().min(3).max(5000),
  incidentAt: z.string().datetime().optional(),
  amountClaimedCents: z.number().int().positive().optional(),
});

export const updateInsuranceClaimInput = z.object({
  status: z.enum(["lodged", "assessing", "settled", "denied", "withdrawn"]),
  claimNumber: z.string().trim().min(1).max(100).optional(),
  amountSettledCents: z.number().int().nonnegative().optional(),
  settlementDocumentId: z.string().uuid().optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
});

export interface InsuranceReadiness {
  buildingRequired: boolean;
  publicLiabilityRequired: boolean;
  exemption: string | null;
  buildingPolicy: typeof insurancePolicies.$inferSelect | null;
  publicLiabilityPolicy: typeof insurancePolicies.$inferSelect | null;
  buildingReady: boolean;
  publicLiabilityReady: boolean;
  ready: boolean;
  reasons: string[];
}

async function getScheme(ctx: ServiceContext, schemeId: string) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  return scheme;
}

export async function getInsuranceReadiness(
  ctx: ServiceContext,
  schemeId: string,
): Promise<InsuranceReadiness> {
  const scheme = await getScheme(ctx, schemeId);
  const today = toDateOnly(ctx.clock.now());
  const policies = await ctx.db.query.insurancePolicies.findMany({
    where: and(
      eq(insurancePolicies.schemeId, schemeId),
      inArray(insurancePolicies.kind, ["building", "public_liability"]),
    ),
    orderBy: (t, { desc }) => desc(t.periodEnd),
  });
  const current = policies.filter(
    (p) => p.status !== "cancelled" && p.periodStart <= today && p.periodEnd >= today,
  );
  const buildingPolicy = current.find((p) => p.kind === "building") ?? null;
  const publicLiabilityPolicy = current.find((p) => p.kind === "public_liability") ?? null;

  const exempt = scheme.insuranceExemption !== null;
  // Multi-storey schemes require both covers for all lots. Otherwise, building
  // cover is required where the OC has insurable common property; public
  // liability applies to common property except the two-lot exception.
  const buildingRequired = !exempt && (scheme.isMultiStorey || scheme.hasCommonProperty);
  const publicLiabilityRequired =
    !exempt && (scheme.isMultiStorey || (scheme.hasCommonProperty && scheme.tier !== 5));
  const buildingReady =
    !buildingRequired ||
    Boolean(
      buildingPolicy?.reinstatementAndReplacement &&
        buildingPolicy.certificateDocumentId !== null &&
        (buildingPolicy.sumInsuredCents ?? 0) > 0,
    );
  const publicLiabilityReady =
    !publicLiabilityRequired ||
    (publicLiabilityPolicy !== null &&
      publicLiabilityPolicy.certificateDocumentId !== null &&
      (publicLiabilityPolicy.sumInsuredCents ?? 0) >= MIN_PUBLIC_LIABILITY_CENTS);
  const reasons: string[] = [];
  if (!buildingReady)
    reasons.push("Current reinstatement and replacement building cover is required");
  if (!publicLiabilityReady)
    reasons.push("Current public liability cover of at least $20 million is required");
  return {
    buildingRequired,
    publicLiabilityRequired,
    exemption: scheme.insuranceExemption,
    buildingPolicy,
    publicLiabilityPolicy,
    buildingReady,
    publicLiabilityReady,
    ready: buildingReady && publicLiabilityReady,
    reasons,
  };
}

export async function listInsurance(ctx: ServiceContext, schemeId: string) {
  await getScheme(ctx, schemeId);
  const [policies, claims, valuations, readiness] = await Promise.all([
    ctx.db.query.insurancePolicies.findMany({
      where: eq(insurancePolicies.schemeId, schemeId),
      orderBy: (t, { desc }) => desc(t.periodEnd),
    }),
    ctx.db.query.insuranceClaims.findMany({
      where: eq(insuranceClaims.schemeId, schemeId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    }),
    ctx.db.query.insuranceValuations.findMany({
      where: eq(insuranceValuations.schemeId, schemeId),
      orderBy: (t, { desc }) => desc(t.valuedOn),
    }),
    getInsuranceReadiness(ctx, schemeId),
  ]);
  return { policies, claims, valuations, readiness };
}

export async function recordPolicy(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof recordInsurancePolicyInput>,
) {
  await getScheme(ctx, schemeId);
  const parsed = recordInsurancePolicyInput.parse(input);
  const certificate = await ctx.db.query.documents.findFirst({
    where: and(
      eq(documents.id, parsed.certificateDocumentId),
      eq(documents.schemeId, schemeId),
      eq(documents.category, "insurance"),
    ),
  });
  if (!certificate) {
    throw new DomainError(
      "INVALID_INSURANCE_CERTIFICATE",
      "Certificate must be an insurance document in this scheme",
      422,
    );
  }
  const today = toDateOnly(ctx.clock.now());
  const status =
    parsed.periodEnd < today ? "expired" : parsed.periodStart > today ? "draft" : "current";
  const result = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(insurancePolicies)
      .values({
        ...parsed,
        schemeId,
        status,
        reinstatementAndReplacement: parsed.reinstatementAndReplacement ?? false,
      })
      .returning();
    const policy = rows[0]!;
    await publishEvent(tx, {
      schemeId,
      stream: `insurance_policy:${policy.id}`,
      type: "insurance.policy.recorded",
      payload: { policyId: policy.id, kind: policy.kind, periodEnd: policy.periodEnd },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return policy;
  });
  await raiseObligation(ctx, {
    schemeId,
    kind: "insurance_renewal",
    title: `${parsed.kind === "building" ? "Building" : "Public liability"} insurance renewal`,
    dueOn: parsed.periodEnd,
    subjectRef: `policy:${result.id}`,
    sourceRef: { policyId: result.id },
  });
  return result;
}

export async function recordValuation(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof recordInsuranceValuationInput>,
) {
  await getScheme(ctx, schemeId);
  const parsed = recordInsuranceValuationInput.parse(input);
  const report = await ctx.db.query.documents.findFirst({
    where: and(eq(documents.id, parsed.reportDocumentId), eq(documents.schemeId, schemeId)),
  });
  if (!report) {
    throw new DomainError(
      "INVALID_VALUATION_REPORT",
      "Valuation report must belong to this scheme",
      422,
    );
  }
  const nextDueOn = addMonthsDateOnly(parsed.valuedOn, 60);
  const rows = await ctx.db
    .insert(insuranceValuations)
    .values({ ...parsed, schemeId, nextDueOn })
    .returning();
  const valuation = rows[0]!;
  await raiseObligation(ctx, {
    schemeId,
    kind: "valuation",
    title: "Five-year building insurance valuation",
    dueOn: nextDueOn,
    subjectRef: `valuation:${valuation.id}`,
    sourceRef: { valuationId: valuation.id },
  });
  return valuation;
}

export async function createClaim(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createInsuranceClaimInput>,
) {
  const parsed = createInsuranceClaimInput.parse(input);
  const policy = await ctx.db.query.insurancePolicies.findFirst({
    where: and(eq(insurancePolicies.id, parsed.policyId), eq(insurancePolicies.schemeId, schemeId)),
  });
  if (!policy) throw notFound("Insurance policy");
  const rows = await ctx.db
    .insert(insuranceClaims)
    .values({
      schemeId,
      policyId: policy.id,
      description: parsed.description,
      incidentAt: parsed.incidentAt ? new Date(parsed.incidentAt) : null,
      amountClaimedCents: parsed.amountClaimedCents ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function updateClaim(
  ctx: ServiceContext,
  schemeId: string,
  claimId: string,
  input: z.infer<typeof updateInsuranceClaimInput>,
) {
  const parsed = updateInsuranceClaimInput.parse(input);
  const claim = await ctx.db.query.insuranceClaims.findFirst({
    where: and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.schemeId, schemeId)),
  });
  if (!claim) throw notFound("Insurance claim");
  if (parsed.settlementDocumentId) {
    const settlement = await ctx.db.query.documents.findFirst({
      where: and(eq(documents.id, parsed.settlementDocumentId), eq(documents.schemeId, schemeId)),
    });
    if (!settlement) {
      throw new DomainError(
        "INVALID_SETTLEMENT_DOCUMENT",
        "Settlement document must belong to this scheme",
        422,
      );
    }
  }
  if (claim.status === "settled" || claim.status === "denied" || claim.status === "withdrawn") {
    throw new DomainError("CLAIM_CLOSED", "A closed claim cannot be changed", 409);
  }
  const rows = await ctx.db
    .update(insuranceClaims)
    .set({
      ...parsed,
      lodgedAt: parsed.status === "lodged" && !claim.lodgedAt ? ctx.clock.now() : claim.lodgedAt,
    })
    .where(and(eq(insuranceClaims.id, claimId), eq(insuranceClaims.schemeId, schemeId)))
    .returning();
  return rows[0]!;
}
