/**
 * P1 (build track) — Manager registration & PI insurance capture.
 *
 * The registered-manager path (OC Act) requires the manager to hold a current
 * Business Licensing Authority registration and ≥$2M professional-indemnity
 * cover held continuously (s119(5)/reg10). This service captures both at the
 * ORGANISATION level and drives the compliance calendar:
 *   - recording/renewing the registration raises a `registration_renewal`
 *     obligation off the registration's review date;
 *   - recording a PI policy raises a `pi_expiry` obligation off `expiresOn`.
 *
 * The compliance-calendar service (`raiseObligation` / `sweep`) is the sole
 * writer of `compliance_obligations`; this service is the thin capture layer
 * on top of it. Each `raiseObligation` call publishes `compliance.obligation.
 * raised` in its own transaction — that event (carrying the captured number /
 * policy in `sourceRef`) is the audit record of the capture. The denormalised
 * `organizations.managerRegistrationNumber` column and `manager_pi_policies`
 * rows are the queryable projection the register (s147/148) and OC
 * certificates read from.
 */
import {
  documents,
  managerAppointments,
  managerPiPolicies,
  managerRegistrationChecks,
  organizations,
  ownerships,
  people,
  schemes,
} from "@goodstrata/db";
import {
  addDays,
  addMonthsDateOnly,
  fromDateOnly,
  isRealDateOnly,
  toDateOnly,
} from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { sendEmail } from "./comms.js";
import { raiseObligation } from "./compliance.js";
import { requireCarriedResolution } from "./resolutionValidation.js";

export type Organization = typeof organizations.$inferSelect;
export type ManagerPiPolicy = typeof managerPiPolicies.$inferSelect;
export type ManagerAppointment = typeof managerAppointments.$inferSelect;

/** ≥$2,000,000 continuous PI cover is the statutory floor (reg 10). */
export const MIN_PI_COVER_CENTS = 200_000_000;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const recordRegistrationInput = z.object({
  registrationNumber: z.string().min(1),
  /** ISO date-only the registration falls due for review; drives the registration_renewal obligation. */
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["current", "suspended", "cancelled", "unknown"]).optional(),
  checkedAt: z.string().datetime().optional(),
  sourceUrl: z.string().url().optional(),
  evidenceDocumentId: z.string().uuid().optional(),
  blaNotifiedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  blaNotificationReference: z.string().trim().min(1).max(200).optional(),
});
export type RecordRegistrationInput = z.infer<typeof recordRegistrationInput>;

export interface RegistrationResult {
  organization: Organization;
  /** The raised (or existing) registration_renewal obligation id. */
  obligationId: string;
}

/**
 * Capture/renew the manager's registration number on the organisation and raise
 * a `registration_renewal` compliance obligation.
 *
 * Under the current regime a registered manager's BLA registration is *ongoing*
 * rather than annually renewed (see docs/REGISTERED-MANAGER-READINESS.md), so
 * this obligation is a periodic *review* — one per calendar year of the review
 * date — not a hard lapse. The sweep escalates it (t_90 → due → overdue) as the
 * review date approaches so it is never silently missed.
 */
export async function recordManagerRegistration(
  ctx: ServiceContext,
  organizationId: string,
  input: RecordRegistrationInput,
): Promise<RegistrationResult> {
  const parsed = recordRegistrationInput.parse(input);

  // Persist the number on the org (queryable projection for the register / OC
  // certificates). updatedAt auto-stamps via $onUpdate.
  const orgRows = await ctx.db
    .update(organizations)
    .set({ managerRegistrationNumber: parsed.registrationNumber })
    .where(eq(organizations.id, organizationId))
    .returning();
  const organization = orgRows[0];
  if (!organization) throw notFound("Organization");

  await ctx.db.insert(managerRegistrationChecks).values({
    organizationId,
    registrationNumber: parsed.registrationNumber,
    status: parsed.status ?? "current",
    checkedAt: parsed.checkedAt ? new Date(parsed.checkedAt) : ctx.clock.now(),
    sourceUrl: parsed.sourceUrl ?? null,
    evidenceDocumentId: parsed.evidenceDocumentId ?? null,
    blaNotifiedOn: parsed.blaNotifiedOn ?? null,
    blaNotificationReference: parsed.blaNotificationReference ?? null,
  });

  // Drive the calendar: a review obligation off the review date. `raiseObligation`
  // publishes `compliance.obligation.raised` in-transaction (idempotent per year).
  const obligation = await raiseObligation(ctx, {
    organizationId,
    kind: "registration_renewal",
    title: "Manager registration review",
    dueOn: parsed.expiresOn,
    subjectRef: "registration",
    sourceRef: { registrationNumber: parsed.registrationNumber },
    meta: {
      registrationNumber: parsed.registrationNumber,
      reviewOn: parsed.expiresOn,
      ongoing: true,
      basis: "docs/REGISTERED-MANAGER-READINESS.md",
    },
  });

  return { organization, obligationId: obligation.id };
}

// ---------------------------------------------------------------------------
// PI insurance
// ---------------------------------------------------------------------------

export const recordPiPolicyInput = z.object({
  insurer: z.string().min(1),
  policyNumber: z.string().min(1),
  coverAmountCents: z.number().int().positive(),
  /** ISO date-only cover start (continuity proof across renewals). */
  effectiveOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** ISO date-only cover expiry; drives the pi_expiry obligation. */
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Certificate-of-currency document id, if uploaded. */
  documentId: z.string().uuid().optional(),
  blaNotifiedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  blaNotificationReference: z.string().trim().min(1).max(200).optional(),
});
export type RecordPiPolicyInput = z.infer<typeof recordPiPolicyInput>;

export interface PiPolicyResult {
  policy: ManagerPiPolicy;
  /** The raised (or existing) pi_expiry obligation id. */
  obligationId: string;
  /** False when the recorded cover is below the ≥$2M statutory floor (reg 10). */
  coverSufficient: boolean;
}

/**
 * Record a manager PI policy period and raise a `pi_expiry` compliance
 * obligation for `expiresOn`.
 *
 * Under-cover is *recorded* (so the platform reflects reality and can warn /
 * escalate) rather than rejected: the `coverSufficient` flag surfaces the
 * ≥$2M shortfall to the caller and UI. One row per policy period; the
 * obligation's subject is the policy id, so each renewal is tracked distinctly.
 */
export async function recordPiPolicy(
  ctx: ServiceContext,
  organizationId: string,
  input: RecordPiPolicyInput,
): Promise<PiPolicyResult> {
  const parsed = recordPiPolicyInput.parse(input);

  // Guard the FK: recording a policy against an unknown org is a not-found.
  const org = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!org) throw notFound("Organization");

  const inserted = await ctx.db
    .insert(managerPiPolicies)
    .values({
      organizationId,
      insurer: parsed.insurer,
      policyNumber: parsed.policyNumber,
      coverAmountCents: parsed.coverAmountCents,
      effectiveOn: parsed.effectiveOn ?? null,
      expiresOn: parsed.expiresOn,
      documentId: parsed.documentId ?? null,
      blaNotifiedOn: parsed.blaNotifiedOn ?? null,
      blaNotificationReference: parsed.blaNotificationReference ?? null,
    })
    .returning();
  const policy = inserted[0]!;

  const coverSufficient = policy.coverAmountCents >= MIN_PI_COVER_CENTS;

  const obligation = await raiseObligation(ctx, {
    organizationId,
    kind: "pi_expiry",
    title: "Manager PI insurance expiry",
    dueOn: parsed.expiresOn,
    subjectRef: `pi_policy:${policy.id}`,
    sourceRef: { policyId: policy.id },
    meta: {
      policyId: policy.id,
      insurer: policy.insurer,
      policyNumber: policy.policyNumber,
      coverAmountCents: policy.coverAmountCents,
      coverSufficient,
    },
  });

  return { policy, obligationId: obligation.id, coverSufficient };
}

export async function listPiPolicies(
  ctx: ServiceContext,
  organizationId: string,
): Promise<ManagerPiPolicy[]> {
  return await ctx.db.query.managerPiPolicies.findMany({
    where: eq(managerPiPolicies.organizationId, organizationId),
    orderBy: (t, { desc: d }) => d(t.expiresOn),
  });
}

export interface RegistrationStatus {
  organizationId: string;
  registrationNumber: string | null;
  currentPiPolicy: ManagerPiPolicy | null;
  piCoverSufficient: boolean;
  piContinuous: boolean;
  latestRegistrationCheck: typeof managerRegistrationChecks.$inferSelect | null;
  registrationCurrent: boolean;
}

/**
 * Continuity check: PI cover must be held *continuously* AND still be in force
 * as at `today` (reg 10). Order the policy periods by start and confirm each
 * successive period begins on or before the day after the previous one expires
 * (no gap). A seam we can't prove (a successor with no `effectiveOn`) is treated
 * as a break, conservatively. Finally, a chain whose latest cover has already
 * lapsed (`max(expiresOn) < today`) is NOT continuous cover today — an expired,
 * never-renewed policy must not read as continuous.
 */
export function isContinuous(
  policies: Pick<ManagerPiPolicy, "effectiveOn" | "expiresOn">[],
  today: string,
): boolean {
  if (policies.length === 0) return false;
  const sorted = [...policies].sort((a, b) => {
    const as = a.effectiveOn ?? a.expiresOn;
    const bs = b.effectiveOn ?? b.expiresOn;
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (!cur.effectiveOn) return false;
    const latestStartAllowed = toDateOnly(addDays(fromDateOnly(prev.expiresOn), 1));
    if (cur.effectiveOn > latestStartAllowed) return false;
  }
  // The chain must reach the present: cover has lapsed if nothing is in force today.
  return policies.some((p) => p.expiresOn >= today);
}

/** Registration + PI snapshot for the s147/148 register and OC certificates. */
export async function getRegistrationStatus(
  ctx: ServiceContext,
  organizationId: string,
): Promise<RegistrationStatus> {
  const org = await ctx.db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
  if (!org) throw notFound("Organization");

  const policies = await ctx.db.query.managerPiPolicies.findMany({
    where: eq(managerPiPolicies.organizationId, organizationId),
    orderBy: (t, { desc: d }) => d(t.expiresOn),
  });
  const latestRegistrationCheck = await ctx.db.query.managerRegistrationChecks.findFirst({
    where: eq(managerRegistrationChecks.organizationId, organizationId),
    orderBy: (t, { desc: d }) => d(t.checkedAt),
  });

  // "Current" = the latest-expiring policy. It only evidences *sufficient* cover
  // if it is ≥$2M AND has not already expired as at today — a lapsed policy,
  // however large, provides no cover (reg 10). String date-only compares safely.
  const today = toDateOnly(ctx.clock.now());
  const currentPiPolicy = policies[0] ?? null;
  const piCoverSufficient =
    currentPiPolicy !== null &&
    currentPiPolicy.coverAmountCents >= MIN_PI_COVER_CENTS &&
    currentPiPolicy.expiresOn >= today;

  return {
    organizationId,
    registrationNumber: org.managerRegistrationNumber,
    currentPiPolicy,
    piCoverSufficient,
    piContinuous: isContinuous(policies, today),
    latestRegistrationCheck: latestRegistrationCheck ?? null,
    registrationCurrent:
      org.managerRegistrationNumber !== null && latestRegistrationCheck?.status === "current",
  };
}

// ---------------------------------------------------------------------------
// Scheme appointment and delegation lifecycle
// ---------------------------------------------------------------------------

const delegatedPower = z.enum([
  "maintenance_and_repairs",
  "collect_fees",
  "maintain_insurance",
  "keep_financial_records",
  "prepare_notices_agendas_minutes",
  "correspondence",
  "pay_invoices",
  "prepare_financial_statements_and_budgets",
  "provide_certificates",
  "keep_register_and_records",
  "arrange_audits_and_reports",
  "administer_grievance_procedure",
]);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDateOnly, "Must be a real calendar date");

export const createManagerAppointmentInput = z
  .object({
    appointedOn: dateOnly,
    startsOn: dateOnly,
    endsOn: dateOnly,
    approvedFormName: z.string().trim().min(1).max(200),
    approvedFormVersion: z.string().trim().min(1).max(100),
    appointmentDocumentId: z.string().uuid(),
    appointmentResolutionId: z.string().uuid(),
    delegationDocumentId: z.string().uuid(),
    delegationResolutionId: z.string().uuid(),
    delegatedPowers: z.array(delegatedPower).min(1),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    path: ["endsOn"],
    message: "Appointment end must be on or after its start",
  });

export const terminateManagerAppointmentInput = z.object({
  terminatedOn: dateOnly,
  terminationResolutionId: z.string().uuid(),
});

async function schemeForAppointment(ctx: ServiceContext, schemeId: string) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  if (!scheme.organizationId)
    throw new DomainError("NO_MANAGEMENT_ORG", "Scheme has no management organisation", 422);
  return scheme;
}

export async function listAppointments(ctx: ServiceContext, schemeId: string) {
  await schemeForAppointment(ctx, schemeId);
  return await ctx.db.query.managerAppointments.findMany({
    where: eq(managerAppointments.schemeId, schemeId),
    orderBy: (t, { desc: d }) => d(t.startsOn),
  });
}

export async function createManagerAppointment(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createManagerAppointmentInput>,
) {
  const scheme = await schemeForAppointment(ctx, schemeId);
  const parsed = createManagerAppointmentInput.parse(input);
  const maxEnd = addMonthsDateOnly(parsed.startsOn, scheme.isRetirementVillage ? 60 : 36);
  if (parsed.endsOn > maxEnd) {
    throw new DomainError(
      "APPOINTMENT_TERM_TOO_LONG",
      `Appointment cannot exceed ${scheme.isRetirementVillage ? 5 : 3} years`,
      422,
    );
  }
  const appointmentDocument = await ctx.db.query.documents.findFirst({
    where: and(eq(documents.id, parsed.appointmentDocumentId), eq(documents.schemeId, schemeId)),
  });
  const delegationDocument = await ctx.db.query.documents.findFirst({
    where: and(eq(documents.id, parsed.delegationDocumentId), eq(documents.schemeId, schemeId)),
  });
  if (!appointmentDocument || !delegationDocument) {
    throw new DomainError(
      "MISSING_APPOINTMENT_DOCUMENT",
      "Appointment and delegation documents must belong to this scheme",
      422,
    );
  }
  await requireCarriedResolution(ctx, schemeId, parsed.appointmentResolutionId, {
    minimum: "ordinary",
  });
  await requireCarriedResolution(ctx, schemeId, parsed.delegationResolutionId, {
    generalMeeting: true,
    minimum: "ordinary",
  });
  const rows = await ctx.db
    .insert(managerAppointments)
    .values({ ...parsed, schemeId, organizationId: scheme.organizationId! })
    .returning();
  return rows[0]!;
}

export async function activateManagerAppointment(
  ctx: ServiceContext,
  schemeId: string,
  appointmentId: string,
) {
  const scheme = await schemeForAppointment(ctx, schemeId);
  const appointment = await ctx.db.query.managerAppointments.findFirst({
    where: and(
      eq(managerAppointments.id, appointmentId),
      eq(managerAppointments.schemeId, schemeId),
    ),
  });
  if (!appointment) throw notFound("Manager appointment");
  if (appointment.status !== "draft")
    throw new DomainError("APPOINTMENT_NOT_DRAFT", "Appointment is not a draft", 409);
  const today = toDateOnly(ctx.clock.now());
  if (appointment.startsOn > today || appointment.endsOn < today) {
    throw new DomainError("APPOINTMENT_NOT_CURRENT", "Appointment term must include today", 422);
  }
  const registration = await getRegistrationStatus(ctx, appointment.organizationId);
  const blockers: string[] = [];
  if (!registration.registrationCurrent) blockers.push("current BLA registration verification");
  if (!registration.piCoverSufficient) blockers.push("at least $2 million current PI cover");
  if (!registration.piContinuous) blockers.push("continuous PI cover");
  if (blockers.length) {
    throw new DomainError(
      "MANAGER_NOT_ELIGIBLE",
      `Cannot activate without ${blockers.join(", ")}`,
      422,
    );
  }
  return await ctx.db.transaction(async (tx) => {
    await tx
      .update(managerAppointments)
      .set({ status: "expired" })
      .where(
        and(eq(managerAppointments.schemeId, schemeId), eq(managerAppointments.status, "active")),
      );
    const rows = await tx
      .update(managerAppointments)
      .set({ status: "active" })
      .where(eq(managerAppointments.id, appointmentId))
      .returning();
    await tx
      .update(schemes)
      .set({ managementMode: "registered_manager" })
      .where(eq(schemes.id, scheme.id));
    return rows[0]!;
  });
}

export async function terminateManagerAppointment(
  ctx: ServiceContext,
  schemeId: string,
  appointmentId: string,
  input: z.infer<typeof terminateManagerAppointmentInput>,
) {
  const parsed = terminateManagerAppointmentInput.parse(input);
  const appointment = await ctx.db.query.managerAppointments.findFirst({
    where: and(
      eq(managerAppointments.id, appointmentId),
      eq(managerAppointments.schemeId, schemeId),
    ),
  });
  if (!appointment) throw notFound("Manager appointment");
  const recordsReturnDueOn = toDateOnly(addDays(fromDateOnly(parsed.terminatedOn), 28));
  const rows = await ctx.db
    .update(managerAppointments)
    .set({ ...parsed, recordsReturnDueOn, status: "terminated" })
    .where(eq(managerAppointments.id, appointmentId))
    .returning();
  await ctx.db
    .update(schemes)
    .set({ managementMode: "self_managed" })
    .where(eq(schemes.id, schemeId));
  return rows[0]!;
}

/** Deliver an auditable appointment/change notice to every current owner with email. */
export async function notifyAppointmentChange(
  ctx: ServiceContext,
  schemeId: string,
  appointmentId: string,
) {
  const appointment = await ctx.db.query.managerAppointments.findFirst({
    where: and(
      eq(managerAppointments.id, appointmentId),
      eq(managerAppointments.schemeId, schemeId),
    ),
  });
  if (!appointment) throw notFound("Manager appointment");
  const recipients = await ctx.db
    .select({ id: people.id, email: people.email, givenName: people.givenName })
    .from(ownerships)
    .innerJoin(people, eq(people.id, ownerships.personId))
    .where(and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn)));
  const unique = [...new Map(recipients.filter((p) => p.email).map((p) => [p.email!, p])).values()];
  for (const recipient of unique) {
    await sendEmail(ctx, {
      schemeId,
      personId: recipient.id,
      to: recipient.email!,
      subject: "Owners corporation manager appointment update",
      body: `The owners corporation manager appointment is now ${appointment.status}. The term is ${appointment.startsOn} to ${appointment.endsOn}. The appointment and delegation instruments are available in the records register.`,
      template: "manager_appointment_change",
      related: { type: "manager_appointment", id: appointment.id },
    });
  }
  await ctx.db
    .update(managerAppointments)
    .set({ changeNotifiedAt: ctx.clock.now() })
    .where(eq(managerAppointments.id, appointmentId));
  return { sent: unique.length };
}
