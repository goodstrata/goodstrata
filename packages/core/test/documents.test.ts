import { documents, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as documentsService from "../src/services/documents.js";

let tdb: TestDatabase;
let schemeId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

const NOW = "2026-07-01T00:00:00Z";
function ctx(actor: Actor = userActor("secretary-1")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Documents Test OC",
      planOfSubdivision: "PS777777K",
      addressLine1: "7 Register Way",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("accessLevelsForRoles", () => {
  it("gives ordinary owners the owner tier only", () => {
    expect(documentsService.accessLevelsForRoles(["owner"])).toEqual(["owners"]);
    expect(documentsService.accessLevelsForRoles([])).toEqual(["owners"]);
  });

  it("gives committee/officer/manager roles every tier", () => {
    for (const role of ["chair", "secretary", "treasurer", "committee_member", "manager_admin"]) {
      expect(documentsService.accessLevelsForRoles(["owner", role])).toEqual([
        "owners",
        "committee",
        "admin",
      ]);
    }
  });
});

describe("documents service", () => {
  it("uploads to storage, records the register row, and defaults to owner access", async () => {
    const doc = await documentsService.uploadDocument(ctx(), schemeId, {
      filename: "certificate-of-currency.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 demo"),
      category: "insurance",
      title: "Insurance certificate of currency",
    });

    expect(doc.title).toBe("Insurance certificate of currency");
    expect(doc.accessLevel).toBe("owners");
    expect(doc.retentionUntil).toBeNull();
    const stored = await integrations.storage.get(doc.storageKey);
    expect(new TextDecoder().decode(stored)).toContain("%PDF-1.4 demo");
  });

  it("stamps s144 seven-year retention on financial records", async () => {
    const doc = await documentsService.uploadDocument(ctx(), schemeId, {
      filename: "fy26-financials.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 financials"),
      category: "financial",
    });
    // NOW is 2026-07-01; +7y (with leap padding) lands mid-2033.
    expect(doc.retentionUntil).toMatch(/^2033-/);
  });

  it("filters the register by category and by access tier", async () => {
    await documentsService.uploadDocument(ctx(), schemeId, {
      filename: "committee-legal-advice.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 advice"),
      category: "correspondence",
      accessLevel: "committee",
    });

    const all = await documentsService.listDocuments(ctx(), schemeId);
    expect(all.length).toBe(3);

    const financialOnly = await documentsService.listDocuments(ctx(), schemeId, "financial");
    expect(financialOnly.map((d) => d.category)).toEqual(["financial"]);

    const ownerVisible = await documentsService.listDocuments(
      ctx(),
      schemeId,
      undefined,
      documentsService.accessLevelsForRoles(["owner"]),
    );
    expect(ownerVisible.every((d) => d.accessLevel === "owners")).toBe(true);
    expect(ownerVisible.length).toBe(2);

    const officerVisible = await documentsService.listDocuments(
      ctx(),
      schemeId,
      undefined,
      documentsService.accessLevelsForRoles(["owner", "secretary"]),
    );
    expect(officerVisible.length).toBe(3);
  });

  it("fetches a single document scheme-scoped", async () => {
    const [doc] = await documentsService.listDocuments(ctx(), schemeId);
    const found = await documentsService.getDocument(ctx(), schemeId, doc!.id);
    expect(found?.id).toBe(doc!.id);

    // Wrong scheme: invisible.
    const other = await tdb.db
      .insert(schemes)
      .values({
        name: "Other OC",
        planOfSubdivision: "PS888888L",
        addressLine1: "8 Elsewhere St",
        suburb: "Coburg",
        postcode: "3058",
        tier: 4,
        status: "active",
      })
      .returning();
    expect(await documentsService.getDocument(ctx(), other[0]!.id, doc!.id)).toBeNull();
  });
});

describe("enforceRetention", () => {
  it("purges a document once its retention date has passed, leaves others alone, and is idempotent", async () => {
    const [expired] = await tdb.db
      .insert(documents)
      .values({
        schemeId,
        category: "financial",
        title: "Old FY19 financials",
        storageKey: "retention-test/old-financials.pdf",
        mime: "application/pdf",
        sizeBytes: 10,
        retentionUntil: "2020-01-01",
        uploadedBy: userActor("secretary-1"),
      })
      .returning();
    await integrations.storage.put(
      expired!.storageKey,
      new TextEncoder().encode("old content"),
      "application/pdf",
    );

    const [notYetDue] = await tdb.db
      .insert(documents)
      .values({
        schemeId,
        category: "financial",
        title: "Still-current financials",
        storageKey: "retention-test/current-financials.pdf",
        mime: "application/pdf",
        sizeBytes: 10,
        retentionUntil: "2099-01-01",
        uploadedBy: userActor("secretary-1"),
      })
      .returning();

    const result = await documentsService.enforceRetention(ctx());
    expect(result.purged).toBe(1);

    const purged = await documentsService.getDocument(ctx(), schemeId, expired!.id);
    expect(purged?.title).toBe("[Deleted — retention period expired]");
    expect(purged?.purgedAt).not.toBeNull();
    await expect(integrations.storage.get(expired!.storageKey)).rejects.toThrow();

    const untouched = await documentsService.getDocument(ctx(), schemeId, notYetDue!.id);
    expect(untouched?.title).toBe("Still-current financials");
    expect(untouched?.purgedAt).toBeNull();

    // Idempotent: re-running finds nothing left to purge.
    const second = await documentsService.enforceRetention(ctx());
    expect(second.purged).toBe(0);
  });
});
