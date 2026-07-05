import { documents } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { storageKey } from "@goodstrata/integrations";
import type { DocumentAccessLevel, DocumentCategory } from "@goodstrata/shared";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";

export interface UploadDocumentInput {
  filename: string;
  contentType: string;
  content: Uint8Array;
  category: DocumentCategory;
  accessLevel?: DocumentAccessLevel;
  title?: string;
}

const FINANCIAL_RETENTION_YEARS = 7;

/** Roles that unlock the committee/admin record tiers (s146 OC Act). */
const OFFICER_TIER_ROLES: ReadonlySet<string> = new Set([
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
]);

/**
 * The document access tiers a member with these roles may read. Ordinary
 * owners see owner-tier records only; committee/officer/manager roles see
 * everything. Single source of truth for both the register listing and the
 * content endpoint, so the register never lists a record the member would
 * then be refused.
 */
export function accessLevelsForRoles(roles: readonly string[]): DocumentAccessLevel[] {
  return roles.some((r) => OFFICER_TIER_ROLES.has(r))
    ? ["owners", "committee", "admin"]
    : ["owners"];
}

export async function uploadDocument(
  ctx: ServiceContext,
  schemeId: string,
  input: UploadDocumentInput,
) {
  const key = storageKey(schemeId, input.filename);
  await ctx.integrations.storage.put(key, input.content, input.contentType);

  // s144 OC Act: financial records kept 7 years.
  const retentionUntil =
    input.category === "financial"
      ? new Date(ctx.clock.now().getTime() + FINANCIAL_RETENTION_YEARS * 365.25 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(documents)
      .values({
        schemeId,
        category: input.category,
        title: input.title ?? input.filename,
        storageKey: key,
        mime: input.contentType,
        sizeBytes: input.content.byteLength,
        accessLevel: input.accessLevel ?? "owners",
        retentionUntil,
        uploadedBy: ctx.actor,
      })
      .returning();
    const doc = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `document:${doc.id}`,
      type: "document.uploaded",
      payload: { documentId: doc.id, category: doc.category, title: doc.title },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return doc;
  });
}

export async function listDocuments(
  ctx: ServiceContext,
  schemeId: string,
  category?: DocumentCategory,
  accessLevels?: readonly DocumentAccessLevel[],
) {
  const conditions = [eq(documents.schemeId, schemeId)];
  if (category) conditions.push(eq(documents.category, category));
  if (accessLevels) conditions.push(inArray(documents.accessLevel, [...accessLevels]));
  return await ctx.db.query.documents.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

/** One document, scheme-scoped (null when absent or belonging to another scheme). */
export async function getDocument(ctx: ServiceContext, schemeId: string, documentId: string) {
  return (
    (await ctx.db.query.documents.findFirst({
      where: and(eq(documents.schemeId, schemeId), eq(documents.id, documentId)),
    })) ?? null
  );
}

export interface RetentionResult {
  scanned: number;
  purged: number;
}

/**
 * Enforce `documents.retentionUntil`: once the retention date has passed,
 * delete the stored object and de-identify the row — clear the title and
 * stamp `purgedAt` — while the row itself (category, access tier, retention
 * date, createdAt) stays behind as the statutory record that something
 * existed here and was disposed of on schedule. Idempotent: a row with
 * `purgedAt` already set is skipped, so a retried/duplicate cron tick is a
 * no-op. Intended to run daily (see boot.ts CRON_RETENTION).
 */
export async function enforceRetention(ctx: ServiceContext): Promise<RetentionResult> {
  const today = ctx.clock.now().toISOString().slice(0, 10);
  const due = await ctx.db.query.documents.findMany({
    where: and(
      isNotNull(documents.retentionUntil),
      lt(documents.retentionUntil, today),
      isNull(documents.purgedAt),
    ),
  });

  let purged = 0;
  for (const doc of due) {
    // Best-effort: if the object is already gone (e.g. a prior run deleted it
    // but a crash left the row unmarked), that shouldn't block de-identifying
    // the row on this pass.
    await ctx.integrations.storage.delete(doc.storageKey).catch(() => {});

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ title: "[Deleted — retention period expired]", purgedAt: ctx.clock.now() })
        .where(eq(documents.id, doc.id));

      await publishEvent(tx, {
        schemeId: doc.schemeId,
        stream: `document:${doc.id}`,
        type: "document.retention.purged",
        payload: { documentId: doc.id, category: doc.category, retentionUntil: doc.retentionUntil },
        actor: ctx.actor,
        ...causationFields(ctx),
      });
    });
    purged += 1;
  }

  return { scanned: due.length, purged };
}
