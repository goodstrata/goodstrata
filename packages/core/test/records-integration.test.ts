import { documents, lots, ownerships, people, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { fixedClock, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as documentsService from "../src/services/documents.js";
import * as recordsService from "../src/services/records.js";

let tdb: TestDatabase;
let schemeId: string;
let lotId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

function ctx(): ServiceContext {
  return {
    db: tdb.db,
    clock: fixedClock("2026-07-01T02:00:00.000Z"),
    integrations,
    actor: userActor("secretary-1"),
  };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const [scheme] = await tdb.db
    .insert(schemes)
    .values({
      name: "Records Test OC",
      planOfSubdivision: "PS767676R",
      addressLine1: "151 Certificate Street",
      suburb: "Melbourne",
      postcode: "3000",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = scheme!.id;
  const [lot] = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "7", entitlement: 10, liability: 12 })
    .returning();
  lotId = lot!.id;
  const [person] = await tdb.db
    .insert(people)
    .values({
      schemeId,
      givenName: "Asha",
      familyName: "Owner",
      mailingAddress: { line1: "7/151 Certificate Street" },
    })
    .returning();
  await tdb.db
    .insert(ownerships)
    .values({ schemeId, lotId, personId: person!.id, startedOn: "2025-01-01" });
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("owners corporation register and records workflows", () => {
  it("projects canonical lots and owners together with register-only items", async () => {
    await recordsService.createRegisterItem(ctx(), schemeId, {
      kind: "rules_amendment",
      title: "Pet rule amendment",
      details: "Registered amendment 2",
      effectiveOn: "2026-03-01",
    });
    const register = await recordsService.getOwnersCorporationRegister(ctx(), schemeId);
    expect(register.scheme.planOfSubdivision).toBe("PS767676R");
    expect(register.lots[0]).toMatchObject({ lotNumber: "7", liability: 12, entitlement: 10 });
    expect(register.lots[0]?.owners[0]?.name).toBe("Asha Owner");
    expect(register.rulesAmendments[0]?.title).toBe("Pet rule amendment");
  });

  it("requires prior consent before verifying a commercial representative", async () => {
    const request = await recordsService.createInspectionRequest(ctx(), schemeId, {
      requesterType: "representative",
      requesterName: "Commercial Search Agent",
      representativeOf: "Asha Owner",
      scope: "register",
      requestedDocumentIds: [],
      wantsCopies: false,
      commercialPurpose: true,
      quotedCopyFeeCents: 0,
    });
    await expect(
      recordsService.verifyInspectionRequest(ctx(), schemeId, request.id, { eligible: true }),
    ).rejects.toMatchObject({ code: "COMMERCIAL_CONSENT_REQUIRED" });
    const verified = await recordsService.verifyInspectionRequest(ctx(), schemeId, request.id, {
      eligible: true,
      commercialConsentAt: new Date("2026-06-30T02:00:00.000Z"),
    });
    expect(verified.status).toBe("eligibility_verified");
  });

  it("starts the paid service clock, issues with prescribed attachments and retains the copy", async () => {
    const uploaded = await Promise.all([
      documentsService.uploadDocument(ctx(), schemeId, {
        filename: "rules.pdf",
        contentType: "application/pdf",
        content: new TextEncoder().encode("rules"),
        category: "rules",
      }),
      documentsService.uploadDocument(ctx(), schemeId, {
        filename: "statement-of-advice.pdf",
        contentType: "application/pdf",
        content: new TextEncoder().encode("advice"),
        category: "other",
      }),
      documentsService.uploadDocument(ctx(), schemeId, {
        filename: "agm-resolutions.pdf",
        contentType: "application/pdf",
        content: new TextEncoder().encode("resolutions"),
        category: "minutes",
        retentionClass: "permanent",
      }),
    ]);
    const request = await recordsService.createCertificateRequest(ctx(), schemeId, {
      lotId,
      applicantName: "Asha Owner",
      urgency: "standard_6_10_days",
      additionalCertificate: false,
      quotedFeeCents: recordsService.certificateMaximumFeeCents("standard_6_10_days"),
      feePaidAt: new Date("2026-07-01T02:00:00.000Z"),
    });
    expect(request.status).toBe("preparing");
    expect(request.dueAt?.toISOString()).toBe("2026-07-15T02:00:00.000Z");

    const issued = await recordsService.issueCertificate(ctx(), schemeId, request.id, {
      attachments: {
        rules: uploaded[0]!.id,
        statementOfAdvice: uploaded[1]!.id,
        lastAgmResolutions: uploaded[2]!.id,
      },
      authorisedByName: "Sam Secretary",
      authorisedByTitle: "Secretary",
      sealAppliedAt: new Date("2026-07-01T02:00:00.000Z"),
      additionalFeeWorkDetails: "No additional unbudgeted works are known.",
    });
    expect(issued.status).toBe("issued");
    const copy = await tdb.db.query.documents.findFirst({
      where: eq(documents.id, issued.certificateDocumentId!),
    });
    expect(copy).toMatchObject({ category: "certificate", retentionClass: "statutory_7_years" });
    expect(copy?.retentionUntil).toMatch(/^2033-/);
  });
});
