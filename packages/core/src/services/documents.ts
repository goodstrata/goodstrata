import { documents } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { storageKey } from "@goodstrata/integrations";
import type { DocumentAccessLevel, DocumentCategory } from "@goodstrata/shared";
import { aliasedTable, and, eq, inArray, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export interface UploadDocumentInput {
  filename: string;
  contentType: string;
  content: Uint8Array;
  category: DocumentCategory;
  accessLevel?: DocumentAccessLevel;
  title?: string;
}

/**
 * Same shape as an upload, but `category` and `accessLevel` are optional —
 * when omitted the replacement inherits them from the revision it supersedes
 * (keeping its retention class and access tier).
 */
export interface SupersedeDocumentInput extends Omit<UploadDocumentInput, "category"> {
  category?: DocumentCategory;
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
  return await createDocument(ctx, schemeId, input, null);
}

/** Shared insert path for uploads and supersede replacements. */
async function createDocument(
  ctx: ServiceContext,
  schemeId: string,
  input: UploadDocumentInput,
  supersedesDocumentId: string | null,
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
        supersedesDocumentId,
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

    if (supersedesDocumentId) {
      // Audit signal on the OLD document's stream: it was replaced, by whom
      // and by which revision.
      await publishEvent(tx, {
        schemeId,
        stream: `document:${supersedesDocumentId}`,
        type: "document.superseded",
        payload: {
          documentId: supersedesDocumentId,
          supersededByDocumentId: doc.id,
          category: doc.category,
          title: doc.title,
        },
        actor: ctx.actor,
        ...causationFields(ctx),
      });
    }

    return doc;
  });
}

/**
 * Upload a replacement revision: a new register row that points back at the
 * old one via `supersedesDocumentId`. The old row is left entirely untouched —
 * its stored object keeps being served (audit trail) at its original access
 * tier, and its `retentionUntil` is never purged or shortened; only the daily
 * retention sweep disposes of it, on schedule.
 */
export async function supersedeDocument(
  ctx: ServiceContext,
  schemeId: string,
  documentId: string,
  input: SupersedeDocumentInput,
) {
  const oldDoc = await getDocument(ctx, schemeId, documentId);
  if (!oldDoc || oldDoc.deletedAt) throw notFound("Document");

  // One current head per chain: a revision that already has a live successor
  // can't be superseded again — supersede the head instead. A soft-deleted
  // successor doesn't count (deleting it restores this revision as current).
  const successor = await ctx.db.query.documents.findFirst({
    where: and(eq(documents.supersedesDocumentId, documentId), isNull(documents.deletedAt)),
  });
  if (successor) {
    throw new DomainError(
      "ALREADY_SUPERSEDED",
      "Document has already been superseded — replace the current revision instead",
      409,
    );
  }

  return await createDocument(
    ctx,
    schemeId,
    {
      ...input,
      category: input.category ?? oldDoc.category,
      accessLevel: input.accessLevel ?? oldDoc.accessLevel,
    },
    documentId,
  );
}

/**
 * Officer soft-delete: hides the document from the register and content
 * serving while the row survives for audit. Statutory records still inside
 * their retention window (s144 OC Act: financial, 7 years) cannot be deleted —
 * for those the daily retention sweep (enforceRetention) is the only disposal
 * path, and it never runs early.
 */
export async function deleteDocument(ctx: ServiceContext, schemeId: string, documentId: string) {
  const doc = await getDocument(ctx, schemeId, documentId);
  if (!doc || doc.deletedAt) throw notFound("Document");

  // Mirror of enforceRetention's due test (`retentionUntil < today`): until
  // the date has passed, the record is statutorily held.
  const today = ctx.clock.now().toISOString().slice(0, 10);
  if (doc.retentionUntil && doc.retentionUntil >= today) {
    throw new DomainError(
      "RETENTION_HELD",
      `Document is under statutory retention until ${doc.retentionUntil} and cannot be deleted`,
      409,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(documents)
      .set({ deletedAt: ctx.clock.now() })
      .where(eq(documents.id, doc.id))
      .returning();

    await publishEvent(tx, {
      schemeId,
      stream: `document:${doc.id}`,
      type: "document.deleted",
      payload: { documentId: doc.id, category: doc.category, title: doc.title },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return rows[0]!;
  });
}

export async function listDocuments(
  ctx: ServiceContext,
  schemeId: string,
  category?: DocumentCategory,
  accessLevels?: readonly DocumentAccessLevel[],
  opts?: { includeSuperseded?: boolean },
) {
  // Soft-deleted rows never list; superseded revisions only on request.
  const conditions = [eq(documents.schemeId, schemeId), isNull(documents.deletedAt)];
  if (category) conditions.push(eq(documents.category, category));
  if (accessLevels) conditions.push(inArray(documents.accessLevel, [...accessLevels]));
  if (!opts?.includeSuperseded) {
    // Current revisions only: hide any row a live (non-deleted) successor
    // points back at. Checked scheme-wide, not against the filtered result,
    // so a successor in another category/tier still retires its predecessor.
    const successors = aliasedTable(documents, "successors");
    conditions.push(
      notExists(
        ctx.db
          .select({ one: sql`1` })
          .from(successors)
          .where(
            and(eq(successors.supersedesDocumentId, documents.id), isNull(successors.deletedAt)),
          ),
      ),
    );
  }
  return await ctx.db.query.documents.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

/**
 * One document, scheme-scoped (null when absent or belonging to another
 * scheme). Returns superseded and soft-deleted rows too — callers that serve
 * content or lists must check `deletedAt` themselves.
 */
export async function getDocument(ctx: ServiceContext, schemeId: string, documentId: string) {
  return (
    (await ctx.db.query.documents.findFirst({
      where: and(eq(documents.schemeId, schemeId), eq(documents.id, documentId)),
    })) ?? null
  );
}

/**
 * The revision chain anchored at the given document, newest first: the
 * document itself, then each older revision it (transitively) supersedes.
 * Soft-deleted revisions are walked through — they still link the chain —
 * but not returned.
 */
export async function getDocumentChain(ctx: ServiceContext, schemeId: string, documentId: string) {
  const chain: NonNullable<Awaited<ReturnType<typeof getDocument>>>[] = [];
  const seen = new Set<string>(); // cycle guard — a corrupt chain must not hang the request
  let cursor: string | null = documentId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const doc = await getDocument(ctx, schemeId, cursor);
    if (!doc) break;
    if (!doc.deletedAt) chain.push(doc);
    cursor = doc.supersedesDocumentId;
  }
  return chain;
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
