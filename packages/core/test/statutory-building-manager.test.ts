import { documents, funds, meetings, motions, organizations, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as insurance from "../src/services/insurance.js";
import * as manager from "../src/services/managerRegistration.js";
import * as maintenance from "../src/services/statutoryMaintenance.js";

let tdb: TestDatabase;
let ctx: ServiceContext;
let schemeId: string;
let organizationId: string;
let evidenceDocumentId: string;
let meetingId: string;
let planResolutionId: string;
let appointmentResolutionId: string;
let delegationResolutionId: string;

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  ctx = {
    db: tdb.db,
    clock: fixedClock("2026-07-04T00:00:00Z"),
    actor: userActor("statutory-test-admin"),
    integrations: {
      ...integrationsFromEnv({
        EMAIL_PROVIDER: "memory",
        SMS_PROVIDER: "memory",
        STORAGE_PROVIDER: "memory",
      }),
      payments: mockPaymentsProvider(),
    },
  };
  const org = await tdb.db
    .insert(organizations)
    .values({ name: "Registered Manager Pty Ltd" })
    .returning();
  organizationId = org[0]!.id;
  const scheme = await tdb.db
    .insert(schemes)
    .values({
      organizationId,
      name: "Statutory Test OC",
      planOfSubdivision: "PS880001A",
      addressLine1: "1 Test Street",
      suburb: "Melbourne",
      postcode: "3000",
      tier: 2,
    })
    .returning();
  schemeId = scheme[0]!.id;
  await tdb.db.insert(funds).values({
    schemeId,
    kind: "maintenance",
    name: "Maintenance fund",
    balanceCents: 5_000_000,
  });
  const docs = await tdb.db
    .insert(documents)
    .values({
      schemeId,
      category: "insurance",
      title: "Signed evidence",
      storageKey: "tests/signed-evidence.pdf",
      mime: "application/pdf",
      sizeBytes: 100,
      uploadedBy: userActor("statutory-test-admin"),
    })
    .returning();
  evidenceDocumentId = docs[0]!.id;
  const meeting = await tdb.db
    .insert(meetings)
    .values({
      schemeId,
      kind: "agm",
      title: "Annual general meeting",
      scheduledAt: new Date("2026-07-03T09:00:00Z"),
      status: "closed",
    })
    .returning();
  meetingId = meeting[0]!.id;
  const resolutionRows = await tdb.db
    .insert(motions)
    .values(
      ["Approve maintenance plan", "Appoint manager", "Delegate manager powers"].map((title) => ({
        schemeId,
        meetingId,
        title,
        text: title,
        resolutionType: "ordinary" as const,
        status: "carried" as const,
        result: { for: 1, against: 0 },
      })),
    )
    .returning();
  planResolutionId = resolutionRows[0]!.id;
  appointmentResolutionId = resolutionRows[1]!.id;
  delegationResolutionId = resolutionRows[2]!.id;
});

afterAll(async () => tdb.cleanup());

describe("structured insurance", () => {
  it("requires both applicable covers and enforces the $20m public-liability floor", async () => {
    await insurance.recordPolicy(ctx, schemeId, {
      kind: "building",
      insurer: "Building Insurance Ltd",
      policyNumber: "BLD-1",
      sumInsuredCents: 100_000_000,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      reinstatementAndReplacement: true,
      certificateDocumentId: evidenceDocumentId,
    });
    expect((await insurance.getInsuranceReadiness(ctx, schemeId)).ready).toBe(false);
    await insurance.recordPolicy(ctx, schemeId, {
      kind: "public_liability",
      insurer: "Liability Insurance Ltd",
      policyNumber: "PL-1",
      sumInsuredCents: insurance.MIN_PUBLIC_LIABILITY_CENTS,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      certificateDocumentId: evidenceDocumentId,
    });
    expect(await insurance.getInsuranceReadiness(ctx, schemeId)).toMatchObject({
      buildingReady: true,
      publicLiabilityReady: true,
      ready: true,
    });
  });

  it("sets the next valuation due date five calendar years later", async () => {
    const result = await insurance.recordValuation(ctx, schemeId, {
      valuerName: "Independent Valuer",
      valuedOn: "2026-06-30",
      replacementValueCents: 120_000_000,
      reportDocumentId: evidenceDocumentId,
    });
    expect(result.nextDueOn).toBe("2031-06-30");
  });
});

describe("statutory maintenance plan", () => {
  it("builds and approves a ten-year fund-linked capital forecast", async () => {
    const plan = await maintenance.createPlan(ctx, schemeId, {
      title: "Ten-year maintenance plan",
      approvedFormVersion: "CAV 2026",
      preparedOn: "2026-07-01",
      coverageStartOn: "2026-07-01",
    });
    const asset = await maintenance.createAsset(ctx, schemeId, {
      name: "Passenger lift",
      category: "vertical_transport",
      location: "Main lobby",
      expectedLifeYears: 25,
      replacementCostCents: 8_000_000,
    });
    await maintenance.addPlanItem(ctx, schemeId, plan.id, {
      assetId: asset.id,
      name: "Lift controller",
      presentCondition: "fair",
      plannedAction: "Replace controller and commission lift",
      scheduledOn: "2030-07-01",
      estimatedCostCents: 8_000_000,
      expectedLifeAfterWorksYears: 15,
    });
    const approved = await maintenance.approvePlan(ctx, schemeId, plan.id, {
      approvedOn: "2026-07-04",
      approvalResolutionId: planResolutionId,
      approvedAtMeetingId: meetingId,
    });
    expect(approved).toMatchObject({ status: "approved", nextReviewOn: "2027-07-04" });
    const report = await maintenance.getAgmMaintenanceReport(ctx, schemeId);
    expect(report).toMatchObject({ required: true, fundingGapCents: 3_000_000 });
  });
});

describe("registered-manager lifecycle", () => {
  it("rejects an overlong term and activates only after registration and PI gates pass", async () => {
    await manager.recordManagerRegistration(ctx, organizationId, {
      registrationNumber: "BLA-TEST-1",
      expiresOn: "2027-07-04",
      status: "current",
    });
    await manager.recordPiPolicy(ctx, organizationId, {
      insurer: "PI Insurance Ltd",
      policyNumber: "PI-1",
      coverAmountCents: manager.MIN_PI_COVER_CENTS,
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      documentId: evidenceDocumentId,
    });
    const base = {
      appointedOn: "2026-07-04",
      startsOn: "2026-07-04",
      approvedFormName: "Approved manager appointment",
      approvedFormVersion: "CAV 2026",
      appointmentDocumentId: evidenceDocumentId,
      appointmentResolutionId,
      delegationDocumentId: evidenceDocumentId,
      delegationResolutionId,
      delegatedPowers: ["maintenance_and_repairs" as const],
    };
    await expect(
      manager.createManagerAppointment(ctx, schemeId, { ...base, endsOn: "2029-07-05" }),
    ).rejects.toMatchObject({ code: "APPOINTMENT_TERM_TOO_LONG" });
    const appointment = await manager.createManagerAppointment(ctx, schemeId, {
      ...base,
      endsOn: "2029-07-04",
    });
    expect(await manager.activateManagerAppointment(ctx, schemeId, appointment.id)).toMatchObject({
      status: "active",
    });
  });
});
