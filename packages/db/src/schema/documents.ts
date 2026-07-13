import {
  DOCUMENT_ACCESS_LEVELS,
  DOCUMENT_CATEGORIES,
  RECORD_RETENTION_CLASSES,
} from "@goodstrata/shared";
import {
  bigint,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { schemes } from "./tenancy.js";

export const documentCategoryEnum = pgEnum("document_category", DOCUMENT_CATEGORIES);
export const documentAccessLevelEnum = pgEnum("document_access_level", DOCUMENT_ACCESS_LEVELS);
export const recordRetentionClassEnum = pgEnum("record_retention_class", RECORD_RETENTION_CLASSES);

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
    /** Why and for how long this record is held; permanent records never purge. */
    retentionClass: recordRetentionClassEnum().notNull().default("operational"),
    retentionBasis: text(),
    /** Stamped by the daily retention sweep once the object is deleted and the row de-identified. */
    purgedAt: timestamp({ withTimezone: true }),
    /**
     * Officer soft-delete: hides the record from the register and content
     * serving, but the row (and any running retention clock) stays behind as
     * the audit trail. Never set while `retentionUntil` is still in the future.
     */
    deletedAt: timestamp({ withTimezone: true }),
    /** Versioning: this row replaces the pointed-at revision (the old row is untouched). */
    supersedesDocumentId: uuid(),
    uploadedBy: jsonb().notNull(), // Actor
    createdAt: createdAt(),
  },
  (t) => [index("documents_scheme_category_idx").on(t.schemeId, t.category)],
);
