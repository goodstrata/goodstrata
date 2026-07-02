import { documents, lots, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { and, eq } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export interface OnboardingStatus {
  hasLots: boolean;
  hasInsurance: boolean;
  ready: boolean;
  status: string;
}

/** What still blocks activation — drives the onboarding checklist UI. */
export async function onboardingStatus(
  ctx: ServiceContext,
  schemeId: string,
): Promise<OnboardingStatus> {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");

  const lot = await ctx.db.query.lots.findFirst({ where: eq(lots.schemeId, schemeId) });
  const insurance = await ctx.db.query.documents.findFirst({
    where: and(eq(documents.schemeId, schemeId), eq(documents.category, "insurance")),
  });

  const hasLots = !!lot;
  const hasInsurance = !!insurance;
  return {
    hasLots,
    hasInsurance,
    ready: hasLots && hasInsurance,
    status: scheme.status,
  };
}

/**
 * Activate the scheme. Per SPEC §1: a current insurance certificate must be
 * on file (and lots imported) before the platform marks the OC active.
 */
export async function activateScheme(ctx: ServiceContext, schemeId: string) {
  const status = await onboardingStatus(ctx, schemeId);
  if (status.status === "active") {
    throw new DomainError("ALREADY_ACTIVE", "Scheme is already active", 409);
  }
  if (!status.hasLots) {
    throw new DomainError("NO_LOTS", "Import the plan of subdivision lots first", 422);
  }
  if (!status.hasInsurance) {
    throw new DomainError(
      "NO_INSURANCE",
      "Upload a current insurance certificate of currency before activating",
      422,
    );
  }

  await ctx.db.transaction(async (tx) => {
    await tx.update(schemes).set({ status: "active" }).where(eq(schemes.id, schemeId));
    await publishEvent(tx, {
      schemeId,
      stream: `scheme:${schemeId}`,
      type: "scheme.activated",
      payload: {},
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
}
