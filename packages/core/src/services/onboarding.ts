import { lots, managerAppointments, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { and, eq } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { getInsuranceReadiness } from "./insurance.js";
import { getRegistrationStatus } from "./managerRegistration.js";

export interface OnboardingStatus {
  hasLots: boolean;
  hasInsurance: boolean;
  insuranceReasons: string[];
  managerReady: boolean;
  managerReasons: string[];
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
  const hasLots = !!lot;
  const insurance = await getInsuranceReadiness(ctx, schemeId);
  const hasInsurance = insurance.ready;
  const managerReasons: string[] = [];
  let managerReady = true;
  if (scheme.managementMode === "registered_manager") {
    const appointment = await ctx.db.query.managerAppointments.findFirst({
      where: and(
        eq(managerAppointments.schemeId, schemeId),
        eq(managerAppointments.status, "active"),
      ),
      orderBy: (t, { desc }) => desc(t.endsOn),
    });
    if (!appointment)
      managerReasons.push("A current manager appointment and delegation are required");
    if (!scheme.organizationId) managerReasons.push("A management organisation is required");
    if (scheme.organizationId) {
      const status = await getRegistrationStatus(ctx, scheme.organizationId);
      if (!status.registrationCurrent)
        managerReasons.push("Current BLA registration must be verified");
      if (!status.piCoverSufficient || !status.piContinuous)
        managerReasons.push("At least $2 million of continuous current PI cover is required");
    }
    managerReady = managerReasons.length === 0;
  } else if (scheme.tier === 1 && !scheme.managerOptOutResolutionId) {
    managerReady = false;
    managerReasons.push("Tier 1 must appoint a manager or record the special-resolution opt-out");
  }
  return {
    hasLots,
    hasInsurance,
    insuranceReasons: insurance.reasons,
    managerReady,
    managerReasons,
    ready: hasLots && hasInsurance && managerReady,
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
      status.insuranceReasons.join("; ") ||
        "Record the required current insurance before activating",
      422,
    );
  }
  if (!status.managerReady) {
    throw new DomainError("MANAGER_NOT_READY", status.managerReasons.join("; "), 422);
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
