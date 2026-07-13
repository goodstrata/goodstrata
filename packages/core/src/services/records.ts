import {
  documents,
  insurancePolicies,
  levyNotices,
  levySchedules,
  lotLedgerEntries,
  lots,
  organizations,
  ownersCorporationCertificateRequests,
  ownersCorporationRegisterItems,
  ownerships,
  paymentAllocations,
  people,
  recordInspectionRequests,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";
import { uploadDocument } from "./documents.js";

const requesterType = z.enum(["lot_owner", "mortgagee", "buyer", "representative"]);
const inspectionScope = z.enum(["register", "records", "both"]);
const certificateUrgency = z.enum(["standard_6_10_days", "priority_3_5_days", "urgent_2_days"]);

/**
 * Versioned 2026-27 Victorian fee-unit settings. Amounts remain explicit in
 * every request row, so a later annual indexation never rewrites history.
 */
export const VICTORIAN_OC_FEE_SCHEDULE_2026_27 = {
  effectiveFrom: "2026-07-01",
  effectiveTo: "2027-06-30",
  feeUnitCents: 1727,
  certificateUnits: {
    standard_6_10_days: { first: 9.64, additional: 5.3, deadlineBusinessDays: 10 },
    priority_3_5_days: { first: 14.46, additional: 7.95, deadlineBusinessDays: 5 },
    urgent_2_days: { first: 17.35, additional: 9.54, deadlineBusinessDays: 2 },
  },
  registerCopyUnits: 3.03,
  firstRecordCopyUnits: 1.15,
  additionalRecordCopyCents: 760,
  printedPageCents: 20,
} as const;

/** Statewide weekday holidays inside the 2026-27 fee-schedule period. */
export const VICTORIAN_PUBLIC_HOLIDAYS_2026_27 = [
  "2026-09-25",
  "2026-11-03",
  "2026-12-25",
  "2026-12-28",
  "2027-01-01",
  "2027-01-26",
  "2027-03-08",
  "2027-03-26",
  "2027-03-29",
  "2027-06-14",
] as const;

function feeUnitsToCents(units: number): number {
  return Math.round(units * VICTORIAN_OC_FEE_SCHEDULE_2026_27.feeUnitCents);
}

export function certificateMaximumFeeCents(
  urgency: z.infer<typeof certificateUrgency>,
  additional = false,
): number {
  const band = VICTORIAN_OC_FEE_SCHEDULE_2026_27.certificateUnits[urgency];
  return feeUnitsToCents(additional ? band.additional : band.first);
}

export function inspectionMaximumCopyFeeCents(input: {
  scope: z.infer<typeof inspectionScope>;
  recordCount: number;
  printedPages?: number;
}): number {
  let cents = 0;
  if (input.scope === "register" || input.scope === "both") {
    cents += feeUnitsToCents(VICTORIAN_OC_FEE_SCHEDULE_2026_27.registerCopyUnits);
  }
  if ((input.scope === "records" || input.scope === "both") && input.recordCount > 0) {
    cents += feeUnitsToCents(VICTORIAN_OC_FEE_SCHEDULE_2026_27.firstRecordCopyUnits);
    cents +=
      Math.max(0, input.recordCount - 1) *
      VICTORIAN_OC_FEE_SCHEDULE_2026_27.additionalRecordCopyCents;
  }
  cents +=
    Math.max(0, input.printedPages ?? 0) * VICTORIAN_OC_FEE_SCHEDULE_2026_27.printedPageCents;
  return cents;
}

/** Weekend-aware statutory clock. Victorian public holidays are injectable. */
export function addBusinessDays(from: Date, days: number, holidays: readonly string[] = []): Date {
  const result = new Date(from.getTime());
  const closed = new Set(holidays);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6 && !closed.has(result.toISOString().slice(0, 10))) remaining -= 1;
  }
  return result;
}

export const createRegisterItemInput = z.object({
  kind: z.enum(["rules_amendment", "contract", "lease", "licence"]),
  title: z.string().trim().min(1).max(300),
  details: z.string().trim().min(1).max(5_000),
  counterparty: z.string().trim().max(300).optional(),
  effectiveOn: z.string().date(),
  expiresOn: z.string().date().optional(),
  documentId: z.string().uuid().optional(),
});

export const updateRegisterBasisInput = z.object({
  lotLiabilityBasis: z.string().trim().min(1).max(2_000),
  lotEntitlementBasis: z.string().trim().min(1).max(2_000),
});

export async function updateRegisterBasis(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof updateRegisterBasisInput>,
) {
  const rows = await ctx.db.update(schemes).set(input).where(eq(schemes.id, schemeId)).returning();
  if (!rows[0]) throw notFound("Scheme");
  return rows[0];
}

export async function createRegisterItem(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createRegisterItemInput>,
) {
  if (input.documentId) await assertDocumentsBelongToScheme(ctx, schemeId, [input.documentId]);
  const rows = await ctx.db
    .insert(ownersCorporationRegisterItems)
    .values({
      ...input,
      schemeId,
      counterparty: input.counterparty ?? null,
      expiresOn: input.expiresOn ?? null,
      documentId: input.documentId ?? null,
    })
    .returning();
  return rows[0]!;
}

/** First-class s150 register projection, generated from canonical operational tables. */
export async function getOwnersCorporationRegister(ctx: ServiceContext, schemeId: string) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  const [lotRows, ownerRows, items, policies, manager] = await Promise.all([
    ctx.db.query.lots.findMany({
      where: eq(lots.schemeId, schemeId),
      orderBy: (t, { asc }) => asc(t.lotNumber),
    }),
    ctx.db
      .select({
        lotId: ownerships.lotId,
        personId: people.id,
        givenName: people.givenName,
        familyName: people.familyName,
        companyName: people.companyName,
        mailingAddress: people.mailingAddress,
      })
      .from(ownerships)
      .innerJoin(people, eq(ownerships.personId, people.id))
      .where(and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn))),
    ctx.db.query.ownersCorporationRegisterItems.findMany({
      where: eq(ownersCorporationRegisterItems.schemeId, schemeId),
      orderBy: (t, { desc }) => desc(t.effectiveOn),
    }),
    ctx.db.query.insurancePolicies.findMany({
      where: eq(insurancePolicies.schemeId, schemeId),
      orderBy: (t, { desc }) => desc(t.periodEnd),
    }),
    scheme.organizationId
      ? ctx.db.query.organizations.findFirst({ where: eq(organizations.id, scheme.organizationId) })
      : Promise.resolve(undefined),
  ]);

  return {
    preparedAt: ctx.clock.now(),
    scheme: {
      name: scheme.name,
      planOfSubdivision: scheme.planOfSubdivision,
      address: [
        scheme.addressLine1,
        scheme.addressLine2,
        scheme.suburb,
        scheme.state,
        scheme.postcode,
      ]
        .filter(Boolean)
        .join(", "),
    },
    manager: manager
      ? {
          name: manager.name,
          registrationNumber: manager.managerRegistrationNumber,
          contactEmail: manager.contactEmail,
        }
      : null,
    lots: lotRows.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      liability: lot.liability,
      entitlement: lot.entitlement,
      owners: ownerRows
        .filter((owner) => owner.lotId === lot.id)
        .map((owner) => ({
          personId: owner.personId,
          name: owner.companyName ?? [owner.givenName, owner.familyName].filter(Boolean).join(" "),
          address: owner.mailingAddress,
        })),
    })),
    rulesAmendments: items.filter((item) => item.kind === "rules_amendment"),
    contracts: items.filter((item) => item.kind !== "rules_amendment"),
    insurancePolicies: policies,
    /** The plan should supply these; explicit null makes missing source data visible. */
    liabilityBasis: scheme.lotLiabilityBasis,
    entitlementBasis: scheme.lotEntitlementBasis,
  };
}

export const createInspectionRequestInput = z.object({
  requesterType,
  requesterName: z.string().trim().min(1).max(300),
  requesterEmail: z.string().trim().email().optional(),
  requesterAddress: z.string().trim().max(500).optional(),
  lotId: z.string().uuid().optional(),
  representativeOf: z.string().trim().max(300).optional(),
  scope: inspectionScope,
  requestedDocumentIds: z.array(z.string().uuid()).max(200).default([]),
  wantsCopies: z.boolean().default(false),
  commercialPurpose: z.boolean().default(false),
  purpose: z.string().trim().max(1_000).optional(),
  quotedCopyFeeCents: z.number().int().nonnegative().default(0),
});

export async function createInspectionRequest(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createInspectionRequestInput>,
) {
  if (input.requesterType === "representative" && !input.representativeOf) {
    throw new DomainError(
      "REPRESENTATIVE_PRINCIPAL_REQUIRED",
      "Identify who the representative acts for",
      422,
    );
  }
  if (
    (input.scope === "records" || input.scope === "both") &&
    input.wantsCopies &&
    input.requestedDocumentIds.length === 0
  ) {
    throw new DomainError(
      "COPY_RECORDS_REQUIRED",
      "Select the records to be copied so the statutory fee cap can be calculated",
      422,
    );
  }
  if (input.lotId) await assertLotBelongsToScheme(ctx, schemeId, input.lotId);
  await assertDocumentsBelongToScheme(ctx, schemeId, input.requestedDocumentIds);
  const maximumCopyFeeCents = input.wantsCopies
    ? inspectionMaximumCopyFeeCents({
        scope: input.scope,
        recordCount: input.requestedDocumentIds.length,
      })
    : 0;
  if (input.quotedCopyFeeCents > maximumCopyFeeCents) {
    throw new DomainError(
      "FEE_CAP_EXCEEDED",
      `Copy fee exceeds the current maximum of $${(maximumCopyFeeCents / 100).toFixed(2)}`,
      422,
    );
  }
  const rows = await ctx.db
    .insert(recordInspectionRequests)
    .values({
      schemeId,
      requesterType: input.requesterType,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail ?? null,
      requesterAddress: input.requesterAddress ?? null,
      lotId: input.lotId ?? null,
      representativeOf: input.representativeOf ?? null,
      scope: input.scope,
      requestedDocumentIds: input.requestedDocumentIds,
      wantsCopies: input.wantsCopies,
      commercialPurpose: input.commercialPurpose,
      purpose: input.purpose ?? null,
      copyFeeCents: input.quotedCopyFeeCents,
      maximumCopyFeeCents,
    })
    .returning();
  return rows[0]!;
}

export const verifyInspectionRequestInput = z.discriminatedUnion("eligible", [
  z.object({ eligible: z.literal(false), declinedReason: z.string().trim().min(1).max(1_000) }),
  z.object({
    eligible: z.literal(true),
    commercialConsentAt: z.coerce.date().optional(),
    consentEvidenceDocumentId: z.string().uuid().optional(),
  }),
]);

export async function verifyInspectionRequest(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  input: z.infer<typeof verifyInspectionRequestInput>,
) {
  const request = await getInspectionRequest(ctx, schemeId, requestId);
  if (request.status !== "submitted")
    throw new DomainError("BAD_STATUS", "Inspection request has already been assessed", 409);
  if (!input.eligible) {
    const rows = await ctx.db
      .update(recordInspectionRequests)
      .set({ status: "declined", declinedReason: input.declinedReason, handledBy: ctx.actor })
      .where(eq(recordInspectionRequests.id, requestId))
      .returning();
    return rows[0]!;
  }
  if (
    request.requesterType === "representative" &&
    request.commercialPurpose &&
    !input.commercialConsentAt
  ) {
    throw new DomainError(
      "COMMERCIAL_CONSENT_REQUIRED",
      "Prior owners corporation consent is required for a representative's commercial-purpose request",
      422,
    );
  }
  if (input.consentEvidenceDocumentId)
    await assertDocumentsBelongToScheme(ctx, schemeId, [input.consentEvidenceDocumentId]);
  const rows = await ctx.db
    .update(recordInspectionRequests)
    .set({
      status: "eligibility_verified",
      commercialConsentAt: input.commercialConsentAt ?? null,
      consentEvidenceDocumentId: input.consentEvidenceDocumentId ?? null,
      handledBy: ctx.actor,
    })
    .where(eq(recordInspectionRequests.id, requestId))
    .returning();
  return rows[0]!;
}

export async function scheduleInspection(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  scheduledAt: Date,
) {
  const request = await getInspectionRequest(ctx, schemeId, requestId);
  if (request.status !== "eligibility_verified")
    throw new DomainError("BAD_STATUS", "Verify eligibility before scheduling an inspection", 409);
  const rows = await ctx.db
    .update(recordInspectionRequests)
    .set({ status: "scheduled", scheduledAt, handledBy: ctx.actor })
    .where(eq(recordInspectionRequests.id, requestId))
    .returning();
  return rows[0]!;
}

export async function completeInspection(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  printedPages = 0,
) {
  const request = await getInspectionRequest(ctx, schemeId, requestId);
  if (request.status !== "scheduled" && request.status !== "eligibility_verified")
    throw new DomainError("BAD_STATUS", "Inspection is not ready to complete", 409);
  const maximum = request.wantsCopies
    ? inspectionMaximumCopyFeeCents({
        scope: request.scope,
        recordCount: request.requestedDocumentIds.length,
        printedPages,
      })
    : 0;
  if (Number(request.copyFeeCents ?? 0) > maximum)
    throw new DomainError(
      "FEE_CAP_EXCEEDED",
      "Recorded copy fee exceeds the final statutory cap",
      422,
    );
  const rows = await ctx.db
    .update(recordInspectionRequests)
    .set({
      status: "completed",
      completedAt: ctx.clock.now(),
      maximumCopyFeeCents: maximum,
      handledBy: ctx.actor,
    })
    .where(eq(recordInspectionRequests.id, requestId))
    .returning();
  return rows[0]!;
}

export async function listInspectionRequests(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.recordInspectionRequests.findMany({
    where: eq(recordInspectionRequests.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

async function getInspectionRequest(ctx: ServiceContext, schemeId: string, id: string) {
  const request = await ctx.db.query.recordInspectionRequests.findFirst({
    where: and(
      eq(recordInspectionRequests.id, id),
      eq(recordInspectionRequests.schemeId, schemeId),
    ),
  });
  if (!request) throw notFound("Inspection request");
  return request;
}

export const createCertificateRequestInput = z.object({
  lotId: z.string().uuid(),
  applicantName: z.string().trim().min(1).max(300),
  applicantEmail: z.string().trim().email().optional(),
  applicantAddress: z.string().trim().max(500).optional(),
  urgency: certificateUrgency.default("standard_6_10_days"),
  additionalCertificate: z.boolean().default(false),
  quotedFeeCents: z.number().int().nonnegative(),
  feePaidAt: z.coerce.date().optional(),
});

export async function createCertificateRequest(
  ctx: ServiceContext,
  schemeId: string,
  input: z.infer<typeof createCertificateRequestInput>,
) {
  await assertLotBelongsToScheme(ctx, schemeId, input.lotId);
  const maximumFeeCents = certificateMaximumFeeCents(input.urgency, input.additionalCertificate);
  if (input.quotedFeeCents > maximumFeeCents)
    throw new DomainError(
      "FEE_CAP_EXCEEDED",
      `Certificate fee exceeds the current maximum of $${(maximumFeeCents / 100).toFixed(2)}`,
      422,
    );
  const receivedAt = ctx.clock.now();
  const start = input.feePaidAt && input.feePaidAt > receivedAt ? input.feePaidAt : receivedAt;
  const deadlineDays =
    VICTORIAN_OC_FEE_SCHEDULE_2026_27.certificateUnits[input.urgency].deadlineBusinessDays;
  const rows = await ctx.db
    .insert(ownersCorporationCertificateRequests)
    .values({
      schemeId,
      lotId: input.lotId,
      applicantName: input.applicantName,
      applicantEmail: input.applicantEmail ?? null,
      applicantAddress: input.applicantAddress ?? null,
      urgency: input.urgency,
      additionalCertificate: input.additionalCertificate,
      writtenRequestReceivedAt: receivedAt,
      feePaidAt: input.feePaidAt ?? null,
      dueAt: input.feePaidAt
        ? addBusinessDays(start, deadlineDays, VICTORIAN_PUBLIC_HOLIDAYS_2026_27)
        : null,
      status: input.feePaidAt ? "preparing" : "awaiting_payment",
      quotedFeeCents: input.quotedFeeCents,
      maximumFeeCents,
    })
    .returning();
  return rows[0]!;
}

export async function recordCertificateFeePaid(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  paidAt: Date,
) {
  const request = await getCertificateRequest(ctx, schemeId, requestId);
  if (request.status !== "awaiting_payment")
    throw new DomainError("BAD_STATUS", "Certificate request is not awaiting payment", 409);
  const start =
    paidAt > request.writtenRequestReceivedAt ? paidAt : request.writtenRequestReceivedAt;
  const days =
    VICTORIAN_OC_FEE_SCHEDULE_2026_27.certificateUnits[request.urgency].deadlineBusinessDays;
  const rows = await ctx.db
    .update(ownersCorporationCertificateRequests)
    .set({
      feePaidAt: paidAt,
      dueAt: addBusinessDays(start, days, VICTORIAN_PUBLIC_HOLIDAYS_2026_27),
      status: "preparing",
    })
    .where(eq(ownersCorporationCertificateRequests.id, requestId))
    .returning();
  return rows[0]!;
}

export const issueCertificateInput = z.object({
  attachments: z.object({
    rules: z.string().uuid(),
    statementOfAdvice: z.string().uuid(),
    lastAgmResolutions: z.string().uuid(),
  }),
  authorisedByName: z.string().trim().min(1).max(300),
  authorisedByTitle: z.string().trim().min(1).max(200),
  sealAppliedAt: z.coerce.date(),
  additionalFeeWorkDetails: z.string().trim().min(1).max(5_000),
});

export async function issueCertificate(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  input: z.infer<typeof issueCertificateInput>,
) {
  const request = await getCertificateRequest(ctx, schemeId, requestId);
  const dueAt = request.dueAt;
  if (request.status !== "preparing" || !request.feePaidAt || !dueAt)
    throw new DomainError(
      "BAD_STATUS",
      "A paid request must be preparing before it can be issued",
      409,
    );
  await assertDocumentsBelongToScheme(ctx, schemeId, Object.values(input.attachments));
  const snapshot = await buildCertificateSnapshot(
    ctx,
    schemeId,
    request.lotId,
    input.additionalFeeWorkDetails,
  );
  const markdown = renderCertificateMarkdown(snapshot, request, input);
  const certificate = await uploadDocument(ctx, schemeId, {
    filename: `owners-corporation-certificate-${snapshot.lot.lotNumber}-${request.id}.md`,
    contentType: "text/markdown",
    content: new TextEncoder().encode(markdown),
    title: `Owners corporation certificate — lot ${snapshot.lot.lotNumber}`,
    category: "certificate",
    accessLevel: "owners",
    retentionClass: "statutory_7_years",
    retentionBasis: "Issued owners corporation certificate copy — minimum seven years",
  });
  const issuedAt = ctx.clock.now();
  const rows = await ctx.db.transaction(async (tx) => {
    const updated = await tx
      .update(ownersCorporationCertificateRequests)
      .set({
        status: "issued",
        attachmentDocumentIds: input.attachments,
        snapshot,
        certificateDocumentId: certificate.id,
        issuedAt,
        issuedBy: ctx.actor,
        authorisedByName: input.authorisedByName,
        authorisedByTitle: input.authorisedByTitle,
        sealAppliedAt: input.sealAppliedAt,
        additionalFeeWorkDetails: input.additionalFeeWorkDetails,
      })
      .where(eq(ownersCorporationCertificateRequests.id, requestId))
      .returning();
    await publishEvent(tx, {
      schemeId,
      stream: `certificate_request:${requestId}`,
      type: "owners_corporation_certificate.issued",
      payload: {
        requestId,
        lotId: request.lotId,
        documentId: certificate.id,
        dueAt: dueAt.toISOString(),
        issuedAt: issuedAt.toISOString(),
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return updated[0]!;
  });
  return rows;
}

export async function listCertificateRequests(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.ownersCorporationCertificateRequests.findMany({
    where: eq(ownersCorporationCertificateRequests.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

export async function getCertificatePackage(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
) {
  const request = await getCertificateRequest(ctx, schemeId, requestId);
  if (
    request.status !== "issued" ||
    !request.certificateDocumentId ||
    !request.attachmentDocumentIds ||
    !request.issuedAt ||
    !request.dueAt
  ) {
    throw new DomainError("NOT_ISSUED", "Certificate package is not yet available", 409);
  }
  return {
    requestId: request.id,
    certificateDocumentId: request.certificateDocumentId,
    attachments: request.attachmentDocumentIds,
    issuedAt: request.issuedAt,
    dueAt: request.dueAt,
    issuedWithinServiceLevel: request.issuedAt <= request.dueAt,
  };
}

async function getCertificateRequest(ctx: ServiceContext, schemeId: string, id: string) {
  const request = await ctx.db.query.ownersCorporationCertificateRequests.findFirst({
    where: and(
      eq(ownersCorporationCertificateRequests.id, id),
      eq(ownersCorporationCertificateRequests.schemeId, schemeId),
    ),
  });
  if (!request) throw notFound("Certificate request");
  return request;
}

async function buildCertificateSnapshot(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  additionalFeeWorkDetails: string,
) {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  const lot = await ctx.db.query.lots.findFirst({
    where: and(eq(lots.id, lotId), eq(lots.schemeId, schemeId)),
  });
  if (!scheme || !lot) throw notFound("Lot");
  const [owners, schedules, notices, ledger] = await Promise.all([
    ctx.db
      .select({
        givenName: people.givenName,
        familyName: people.familyName,
        companyName: people.companyName,
      })
      .from(ownerships)
      .innerJoin(people, eq(ownerships.personId, people.id))
      .where(and(eq(ownerships.lotId, lotId), isNull(ownerships.endedOn))),
    ctx.db.query.levySchedules.findMany({
      where: eq(levySchedules.schemeId, schemeId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    }),
    ctx.db.query.levyNotices.findMany({
      where: eq(levyNotices.lotId, lotId),
      orderBy: (t, { desc }) => desc(t.dueOn),
    }),
    ctx.db.query.lotLedgerEntries.findMany({
      where: and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.lotId, lotId)),
    }),
  ]);
  const noticeIds = notices.map((notice) => notice.id);
  const allocations = noticeIds.length
    ? await ctx.db
        .select({
          levyNoticeId: paymentAllocations.levyNoticeId,
          paidCents: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)`,
        })
        .from(paymentAllocations)
        .where(inArray(paymentAllocations.levyNoticeId, noticeIds))
        .groupBy(paymentAllocations.levyNoticeId)
    : [];
  const paidByNotice = new Map(allocations.map((row) => [row.levyNoticeId, Number(row.paidCents)]));
  const latestSchedule = schedules.find((schedule) => schedule.feeKind === "annual") ?? null;
  const currentNotices = latestSchedule
    ? notices.filter((notice) => notice.levyScheduleId === latestSchedule.id)
    : [];
  const fullyPaid = notices.filter(
    (notice) => Number(paidByNotice.get(notice.id) ?? 0) >= Number(notice.totalCents),
  );
  return {
    generatedAt: ctx.clock.now().toISOString(),
    scheme: {
      name: scheme.name,
      planOfSubdivision: scheme.planOfSubdivision,
      address: [
        scheme.addressLine1,
        scheme.addressLine2,
        scheme.suburb,
        scheme.state,
        scheme.postcode,
      ]
        .filter(Boolean)
        .join(", "),
    },
    lot: {
      id: lot.id,
      lotNumber: lot.lotNumber,
      liability: lot.liability,
      entitlement: lot.entitlement,
      owners: owners.map(
        (owner) =>
          owner.companyName ?? [owner.givenName, owner.familyName].filter(Boolean).join(" "),
      ),
    },
    currentFees: latestSchedule
      ? {
          frequency: latestSchedule.frequency,
          annualTotalCents: currentNotices.reduce(
            (sum, notice) => sum + Number(notice.totalCents),
            0,
          ),
          instalmentCents: Number(currentNotices[0]?.totalCents ?? 0),
        }
      : null,
    feesPaidThrough: fullyPaid[0]?.dueOn ?? null,
    totalUnpaidFeesAndChargesCents: Math.max(
      0,
      ledger.reduce((sum, entry) => sum + Number(entry.amountCents), 0),
    ),
    specialFees: schedules
      .filter((schedule) => schedule.feeKind === "special")
      .map((schedule) => ({
        approvedOn: schedule.createdAt.toISOString().slice(0, 10),
        dueOn: schedule.firstDueOn,
        amountCents: Number(
          schedule.specialAllocations?.find((allocation) => allocation.lotId === lotId)
            ?.amountCents ??
            schedule.specialFeeCents ??
            0,
        ),
      })),
    additionalFeeWorkDetails,
    registerInspectionStatement:
      "Further information about prescribed matters is available by inspecting the owners corporation register.",
  };
}

function renderCertificateMarkdown(
  snapshot: Awaited<ReturnType<typeof buildCertificateSnapshot>>,
  request: typeof ownersCorporationCertificateRequests.$inferSelect,
  input: z.infer<typeof issueCertificateInput>,
): string {
  const current = snapshot.currentFees;
  return `# Owners corporation certificate\n\n**Owners corporation:** ${snapshot.scheme.name} (${snapshot.scheme.planOfSubdivision})  \n**Address:** ${snapshot.scheme.address}  \n**Lot:** ${snapshot.lot.lotNumber}  \n**Issued:** ${snapshot.generatedAt.slice(0, 10)}\n\n## Fees and charges\n\n- Current ${current?.frequency ?? "annual/quarterly"} fees: ${current ? `$${(current.annualTotalCents / 100).toFixed(2)} annually; $${(current.instalmentCents / 100).toFixed(2)} per instalment` : "No current levy schedule recorded"}\n- Fees paid through: ${snapshot.feesPaidThrough ?? "No fully-paid issued notice recorded"}\n- Total unpaid fees and charges: $${(snapshot.totalUnpaidFeesAndChargesCents / 100).toFixed(2)}\n- Special fees or levies: ${snapshot.specialFees.length ? snapshot.specialFees.map((fee) => `${fee.approvedOn}, due ${fee.dueOn}, $${(fee.amountCents / 100).toFixed(2)}`).join("; ") : "None recorded"}\n\n## Additional work\n\n${snapshot.additionalFeeWorkDetails}\n\n## Required accompanying documents\n\n- Owners corporation rules: document ${input.attachments.rules}\n- Statement of advice and information: document ${input.attachments.statementOfAdvice}\n- Resolutions made at the last annual general meeting: document ${input.attachments.lastAgmResolutions}\n\n${snapshot.registerInspectionStatement}\n\n---\nAuthorised by ${input.authorisedByName}, ${input.authorisedByTitle}. Common seal recorded as applied ${input.sealAppliedAt.toISOString()}. Request ${request.id}.\n`;
}

async function assertLotBelongsToScheme(ctx: ServiceContext, schemeId: string, lotId: string) {
  const lot = await ctx.db.query.lots.findFirst({
    where: and(eq(lots.id, lotId), eq(lots.schemeId, schemeId)),
  });
  if (!lot) throw notFound("Lot");
}

async function assertDocumentsBelongToScheme(
  ctx: ServiceContext,
  schemeId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return;
  const rows = await ctx.db.query.documents.findMany({
    where: and(
      eq(documents.schemeId, schemeId),
      inArray(documents.id, [...new Set(ids)]),
      isNull(documents.deletedAt),
    ),
  });
  if (rows.length !== new Set(ids).size)
    throw new DomainError(
      "DOCUMENT_NOT_FOUND",
      "One or more selected documents do not belong to this owners corporation",
      422,
    );
}
