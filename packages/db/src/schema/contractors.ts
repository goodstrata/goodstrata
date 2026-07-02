import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { CONTRACTOR_STATUSES, CREDENTIAL_KINDS } from "@goodstrata/shared";
import { createdAt, pk, updatedAt } from "./_common.js";
import { documents } from "./documents.js";
import { organizations, schemes } from "./tenancy.js";

export const contractorStatusEnum = pgEnum("contractor_status", CONTRACTOR_STATUSES);
export const credentialKindEnum = pgEnum("credential_kind", CREDENTIAL_KINDS);

/**
 * schemeId null = shared pool (org- or platform-level); non-null = scheme-local.
 */
export const contractors = pgTable(
  "contractors",
  {
    id: pk(),
    schemeId: uuid().references(() => schemes.id),
    organizationId: uuid().references(() => organizations.id),
    businessName: text().notNull(),
    abn: text(),
    contactName: text(),
    email: text(),
    phone: text(),
    tradeCategories: text().array().notNull().default([]),
    /** Reference into the payments provider for payouts; never raw bank details. */
    payoutRef: text(),
    status: contractorStatusEnum().notNull().default("pending"),
    /** 0–500 (two decimal rating × 100), null until first rating. */
    ratingBasisPoints: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contractors_scheme_idx").on(t.schemeId)],
);

export const contractorCredentials = pgTable(
  "contractor_credentials",
  {
    id: pk(),
    contractorId: uuid()
      .notNull()
      .references(() => contractors.id),
    kind: credentialKindEnum().notNull(),
    reference: text(),
    expiresOn: date().notNull(),
    documentId: uuid().references(() => documents.id),
    createdAt: createdAt(),
  },
  (t) => [index("contractor_credentials_contractor_idx").on(t.contractorId)],
);
