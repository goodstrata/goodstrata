import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { documents } from "./documents.js";
import { lots, schemes } from "./tenancy.js";

export const registerItemKindEnum = pgEnum("register_item_kind", [
  "rules_amendment",
  "contract",
  "lease",
  "licence",
]);

/** Details which cannot be projected from the scheme, lot, owner or policy tables. */
export const ownersCorporationRegisterItems = pgTable(
  "owners_corporation_register_items",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: registerItemKindEnum().notNull(),
    title: text().notNull(),
    details: text().notNull(),
    counterparty: text(),
    effectiveOn: date().notNull(),
    expiresOn: date(),
    documentId: uuid().references(() => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("oc_register_items_scheme_idx").on(t.schemeId, t.kind)],
);

export const inspectionRequesterTypeEnum = pgEnum("inspection_requester_type", [
  "lot_owner",
  "mortgagee",
  "buyer",
  "representative",
]);
export const inspectionScopeEnum = pgEnum("inspection_scope", ["register", "records", "both"]);
export const inspectionStatusEnum = pgEnum("inspection_status", [
  "submitted",
  "eligibility_verified",
  "scheduled",
  "completed",
  "declined",
]);

/** Written s146/register inspection request and its supervised fulfilment trail. */
export const recordInspectionRequests = pgTable(
  "record_inspection_requests",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    requesterType: inspectionRequesterTypeEnum().notNull(),
    requesterName: text().notNull(),
    requesterEmail: text(),
    requesterAddress: text(),
    lotId: uuid().references(() => lots.id),
    representativeOf: text(),
    scope: inspectionScopeEnum().notNull(),
    requestedDocumentIds: jsonb().$type<string[]>().notNull().default([]),
    wantsCopies: boolean().notNull().default(false),
    commercialPurpose: boolean().notNull().default(false),
    commercialConsentAt: timestamp({ withTimezone: true }),
    consentEvidenceDocumentId: uuid().references(() => documents.id),
    purpose: text(),
    status: inspectionStatusEnum().notNull().default("submitted"),
    scheduledAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    declinedReason: text(),
    copyFeeCents: bigint({ mode: "number" }),
    maximumCopyFeeCents: bigint({ mode: "number" }),
    handledBy: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("record_inspections_scheme_status_idx").on(t.schemeId, t.status)],
);

export const certificateUrgencyEnum = pgEnum("certificate_urgency", [
  "standard_6_10_days",
  "priority_3_5_days",
  "urgent_2_days",
]);
export const certificateRequestStatusEnum = pgEnum("certificate_request_status", [
  "awaiting_payment",
  "preparing",
  "issued",
  "cancelled",
]);

/** s151 request, fee/deadline gate, immutable issue snapshot and retained copy. */
export const ownersCorporationCertificateRequests = pgTable(
  "owners_corporation_certificate_requests",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    applicantName: text().notNull(),
    applicantEmail: text(),
    applicantAddress: text(),
    urgency: certificateUrgencyEnum().notNull().default("standard_6_10_days"),
    additionalCertificate: boolean().notNull().default(false),
    status: certificateRequestStatusEnum().notNull().default("awaiting_payment"),
    writtenRequestReceivedAt: timestamp({ withTimezone: true }).notNull(),
    feePaidAt: timestamp({ withTimezone: true }),
    dueAt: timestamp({ withTimezone: true }),
    quotedFeeCents: bigint({ mode: "number" }).notNull(),
    maximumFeeCents: bigint({ mode: "number" }).notNull(),
    attachmentDocumentIds: jsonb().$type<{
      rules: string;
      statementOfAdvice: string;
      lastAgmResolutions: string;
    } | null>(),
    snapshot: jsonb(),
    certificateDocumentId: uuid().references(() => documents.id),
    issuedAt: timestamp({ withTimezone: true }),
    issuedBy: jsonb(),
    authorisedByName: text(),
    authorisedByTitle: text(),
    sealAppliedAt: timestamp({ withTimezone: true }),
    additionalFeeWorkDetails: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("oc_certificate_requests_scheme_status_idx").on(t.schemeId, t.status)],
);
