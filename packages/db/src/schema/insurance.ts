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
import { schemes } from "./tenancy.js";

export const insurancePolicyKindEnum = pgEnum("insurance_policy_kind", [
  "building",
  "public_liability",
  "office_bearers",
  "fidelity",
  "machinery",
  "voluntary_workers",
]);
export const insurancePolicyStatusEnum = pgEnum("insurance_policy_status", [
  "draft",
  "current",
  "expired",
  "cancelled",
]);
export const insuranceClaimStatusEnum = pgEnum("insurance_claim_status", [
  "draft",
  "lodged",
  "assessing",
  "settled",
  "denied",
  "withdrawn",
]);

export const insurancePolicies = pgTable(
  "insurance_policies",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: insurancePolicyKindEnum().notNull(),
    status: insurancePolicyStatusEnum().notNull().default("draft"),
    insurer: text().notNull(),
    policyNumber: text().notNull(),
    sumInsuredCents: bigint({ mode: "number" }),
    excessCents: bigint({ mode: "number" }),
    premiumCents: bigint({ mode: "number" }),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    /** Building cover expressly includes replacement, repair, rebuilding and associated costs. */
    reinstatementAndReplacement: boolean().notNull().default(false),
    /** Written exemption/order evidence when a normally-required cover is not held. */
    exemptionDocumentId: uuid().references(() => documents.id),
    certificateDocumentId: uuid().references(() => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("insurance_policies_scheme_idx").on(t.schemeId)],
);

export const insuranceClaims = pgTable(
  "insurance_claims",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    policyId: uuid()
      .notNull()
      .references(() => insurancePolicies.id),
    description: text().notNull(),
    lodgedAt: timestamp({ withTimezone: true }),
    claimNumber: text(),
    status: insuranceClaimStatusEnum().notNull().default("draft"),
    incidentAt: timestamp({ withTimezone: true }),
    amountClaimedCents: bigint({ mode: "number" }),
    amountSettledCents: bigint({ mode: "number" }),
    settlementDocumentId: uuid().references(() => documents.id),
    outcome: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("insurance_claims_scheme_idx").on(t.schemeId)],
);

/** Five-year building valuation evidence and next-due tracking. */
export const insuranceValuations = pgTable(
  "insurance_valuations",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    valuerName: text().notNull(),
    valuedOn: date().notNull(),
    replacementValueCents: bigint({ mode: "number" }).notNull(),
    nextDueOn: date().notNull(),
    reportDocumentId: uuid().references(() => documents.id),
    presentedAtMeetingId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("insurance_valuations_scheme_idx").on(t.schemeId, t.valuedOn)],
);
