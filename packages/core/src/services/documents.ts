import { documents } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { storageKey } from "@goodstrata/integrations";
import type { DocumentAccessLevel, DocumentCategory } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
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
) {
  return await ctx.db.query.documents.findMany({
    where: category
      ? and(eq(documents.schemeId, schemeId), eq(documents.category, category))
      : eq(documents.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}
