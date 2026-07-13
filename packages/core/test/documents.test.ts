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
    expect(doc.retentionClass).toBe("statutory_7_years");
    expect(doc.retentionUntil).toMatch(/^2033-/);
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

async function upload(overrides: Partial<Parameters<typeof documentsService.uploadDocument>[2]>) {
  return await documentsService.uploadDocument(ctx(), schemeId, {
    filename: "doc.pdf",
    contentType: "application/pdf",
    content: new TextEncoder().encode("%PDF-1.4 base"),
    category: "other",
    ...overrides,
  });
}

describe("supersedeDocument / versioning", () => {
  it("threads the chain: the register lists only the head; includeSuperseded and getDocumentChain expose history", async () => {
    const v1 = await upload({
      filename: "rules-v1.pdf",
      category: "rules",
      accessLevel: "committee",
      title: "Model rules v1",
    });
    const v2 = await documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
      filename: "rules-v2.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 rules v2"),
      title: "Model rules v2",
    });

    expect(v2.supersedesDocumentId).toBe(v1.id);
    // Category and access tier inherit from the superseded revision when omitted.
    expect(v2.category).toBe("rules");
    expect(v2.accessLevel).toBe("committee");

    const current = await documentsService.listDocuments(ctx(), schemeId);
    expect(current.map((d) => d.id)).toContain(v2.id);
    expect(current.map((d) => d.id)).not.toContain(v1.id);

    const withHistory = await documentsService.listDocuments(
      ctx(),
      schemeId,
      undefined,
      undefined,
      { includeSuperseded: true },
    );
    expect(withHistory.map((d) => d.id)).toEqual(expect.arrayContaining([v1.id, v2.id]));

    // A third revision extends the chain, newest first.
    const v3 = await documentsService.supersedeDocument(ctx(), schemeId, v2.id, {
      filename: "rules-v3.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 rules v3"),
      title: "Model rules v3",
    });
    const chain = await documentsService.getDocumentChain(ctx(), schemeId, v3.id);
    expect(chain.map((d) => d.id)).toEqual([v3.id, v2.id, v1.id]);
  });

  it("keeps serving the superseded revision's content at its original tier", async () => {
    const v1 = await upload({
      filename: "budget-old.pdf",
      category: "correspondence",
      accessLevel: "committee",
      content: new TextEncoder().encode("%PDF-1.4 old committee content"),
    });
    await documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
      filename: "budget-new.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 new committee content"),
    });

    // The old row is untouched: still fetchable, same tier, object still stored.
    const old = await documentsService.getDocument(ctx(), schemeId, v1.id);
    expect(old?.deletedAt).toBeNull();
    expect(old?.accessLevel).toBe("committee");
    const stored = await integrations.storage.get(v1.storageKey);
    expect(new TextDecoder().decode(stored)).toContain("old committee content");
  });

  it("refuses to supersede a revision that already has a live successor", async () => {
    const v1 = await upload({ filename: "insurance-v1.pdf", category: "insurance" });
    await documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
      filename: "insurance-v2.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 v2"),
    });

    await expect(
      documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
        filename: "insurance-v2b.pdf",
        contentType: "application/pdf",
        content: new TextEncoder().encode("%PDF-1.4 v2b"),
      }),
    ).rejects.toMatchObject({ code: "ALREADY_SUPERSEDED", status: 409 });
  });

  it("never purges or shortens the superseded revision's retention", async () => {
    const v1 = await upload({ filename: "fy25-ledger.pdf", category: "financial" });
    expect(v1.retentionUntil).toMatch(/^2033-/);

    const v2 = await documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
      filename: "fy25-ledger-restated.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 restated"),
    });

    const old = await documentsService.getDocument(ctx(), schemeId, v1.id);
    expect(old?.retentionUntil).toBe(v1.retentionUntil);
    expect(old?.purgedAt).toBeNull();
    expect(old?.deletedAt).toBeNull();
    // The replacement inherits the financial category and gets its own clock.
    expect(v2.retentionUntil).toMatch(/^2033-/);
  });
});

describe("deleteDocument", () => {
  it("blocks deletion while the statutory retention window is still open", async () => {
    const doc = await upload({ filename: "fy26-ledger.pdf", category: "financial" });

    await expect(documentsService.deleteDocument(ctx(), schemeId, doc.id)).rejects.toMatchObject({
      code: "RETENTION_HELD",
      status: 409,
    });

    // Untouched: still current in the register.
    const listed = await documentsService.listDocuments(ctx(), schemeId);
    expect(listed.some((d) => d.id === doc.id)).toBe(true);
  });

  it("never deletes a permanent building-life record", async () => {
    const doc = await upload({
      filename: "plan-of-subdivision.pdf",
      category: "plan_of_subdivision",
    });
    expect(doc.retentionClass).toBe("permanent");
    expect(doc.retentionUntil).toBeNull();
    await expect(documentsService.deleteDocument(ctx(), schemeId, doc.id)).rejects.toMatchObject({
      code: "PERMANENT_RECORD",
    });
  });

  it("soft-deletes an unretained document: hidden from the register, row and object kept for audit", async () => {
    const doc = await upload({ filename: "old-flyer.pdf", title: "Old flyer" });

    const deleted = await documentsService.deleteDocument(ctx(), schemeId, doc.id);
    expect(deleted.deletedAt).not.toBeNull();

    // Hidden from lists — even the history view.
    const listed = await documentsService.listDocuments(ctx(), schemeId, undefined, undefined, {
      includeSuperseded: true,
    });
    expect(listed.some((d) => d.id === doc.id)).toBe(false);

    // The row survives (audit) and the object was not purged.
    const row = await documentsService.getDocument(ctx(), schemeId, doc.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.title).toBe("Old flyer");
    await expect(integrations.storage.get(doc.storageKey)).resolves.toBeDefined();

    // Deleting again: gone as far as callers are concerned.
    await expect(documentsService.deleteDocument(ctx(), schemeId, doc.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("allows deletion once the retention window has lapsed", async () => {
    const [lapsed] = await tdb.db
      .insert(documents)
      .values({
        schemeId,
        category: "financial",
        title: "FY18 ledger (retention lapsed)",
        storageKey: "delete-test/fy18-ledger.pdf",
        mime: "application/pdf",
        sizeBytes: 10,
        retentionUntil: "2020-01-01", // NOW is 2026-07-01
        uploadedBy: userActor("secretary-1"),
      })
      .returning();

    const deleted = await documentsService.deleteDocument(ctx(), schemeId, lapsed!.id);
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("deleting the head revision restores its predecessor as current and re-opens supersession", async () => {
    const v1 = await upload({ filename: "notice-v1.pdf" });
    const v2 = await documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
      filename: "notice-v2.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 v2"),
    });

    await documentsService.deleteDocument(ctx(), schemeId, v2.id);

    const current = await documentsService.listDocuments(ctx(), schemeId);
    expect(current.some((d) => d.id === v1.id)).toBe(true);
    expect(current.some((d) => d.id === v2.id)).toBe(false);

    // With the deleted successor out of the way, v1 may be superseded anew.
    const v3 = await documentsService.supersedeDocument(ctx(), schemeId, v1.id, {
      filename: "notice-v3.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 v3"),
    });
    expect(v3.supersedesDocumentId).toBe(v1.id);
  });
});
