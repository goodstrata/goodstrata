import { DOCUMENT_ACCESS_LEVELS, DOCUMENT_CATEGORIES } from "@goodstrata/shared";
import { bigint, date, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { schemes } from "./tenancy.js";

export const documentCategoryEnum = pgEnum("document_category", DOCUMENT_CATEGORIES);
export const documentAccessLevelEnum = pgEnum("document_access_level", DOCUMENT_ACCESS_LEVELS);

export const documents = pgTable(
  "documents",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    category: documentCategoryEnum().notNull().default("other"),
    title: text().notNull(),
    storageKey: text().notNull(),
    mime: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    /** s146 OC Act — who may access this record. */
    accessLevel: documentAccessLevelEnum().notNull().default("owners"),
    /** Statutory retention (financial records: 7 years). */
    retentionUntil: date(),
    supersedesDocumentId: uuid(),
    uploadedBy: jsonb().notNull(), // Actor
    createdAt: createdAt(),
  },
  (t) => [index("documents_scheme_category_idx").on(t.schemeId, t.category)],
);
