import { interestAuthorisations, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { requireCarriedResolution } from "./resolutionValidation.js";

/** Current Victorian penalty-interest ceiling (10% p.a. = 1,000 bps). */
export const VIC_PENALTY_INTEREST_CAP_BPS = 1_000;

export const authoriseInterestInput = z
  .object({
    motionId: z.string().uuid(),
    rateBps: z.number().int().min(0).max(VIC_PENALTY_INTEREST_CAP_BPS),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((v) => !v.effectiveUntil || v.effectiveUntil >= v.effectiveFrom, {
    message: "Effective-until date must not precede the start date",
    path: ["effectiveUntil"],
  });

export async function authoriseInterest(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof authoriseInterestInput>,
) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  await requireCarriedResolution(ctx, schemeId, input.motionId, { minimum: "ordinary" });
  if (input.rateBps > VIC_PENALTY_INTEREST_CAP_BPS) {
    throw new DomainError(
      "INTEREST_RATE_EXCEEDS_CAP",
      `Penalty interest cannot exceed ${VIC_PENALTY_INTEREST_CAP_BPS / 100}% per annum`,
      422,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(interestAuthorisations)
      .values({
        schemeId,
        motionId: input.motionId,
        rateBps: input.rateBps,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil ?? null,
      })
      .onConflictDoNothing({ target: interestAuthorisations.motionId })
      .returning();
    const record =
      rows[0] ??
      (await tx.query.interestAuthorisations.findFirst({
        where: eq(interestAuthorisations.motionId, input.motionId),
      }));
    if (!record) throw new Error("Interest authorisation was not persisted");
    if (rows[0]) {
      await publishEvent(tx, {
        schemeId,
        stream: `interest_authorisation:${record.id}`,
        type: "finance.interest.authorised",
        payload: {
          authorisationId: record.id,
          motionId: input.motionId,
          rateBps: input.rateBps,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil ?? null,
        },
        actor: ctx.actor,
        ...causationFields(ctx),
      });
    }
    return record;
  });
}

export async function activeInterestAuthorisation(
  ctx: Pick<ServiceContext, "db">,
  schemeId: string,
  onDate: string,
) {
  return await ctx.db.query.interestAuthorisations.findFirst({
    where: and(
      eq(interestAuthorisations.schemeId, schemeId),
      lte(interestAuthorisations.effectiveFrom, onDate),
      or(
        isNull(interestAuthorisations.effectiveUntil),
        gte(interestAuthorisations.effectiveUntil, onDate),
      ),
    ),
    orderBy: desc(interestAuthorisations.effectiveFrom),
  });
}

export async function listInterestAuthorisations(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.interestAuthorisations.findMany({
    where: eq(interestAuthorisations.schemeId, schemeId),
    orderBy: desc(interestAuthorisations.effectiveFrom),
  });
}
