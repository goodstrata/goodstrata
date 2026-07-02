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

export const insurancePolicies = pgTable(
  "insurance_policies",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: insurancePolicyKindEnum().notNull(),
    insurer: text().notNull(),
    policyNumber: text().notNull(),
    sumInsuredCents: bigint({ mode: "number" }),
    excessCents: bigint({ mode: "number" }),
    premiumCents: bigint({ mode: "number" }),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
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
    status: text().notNull().default("draft"), // draft | lodged | assessing | settled | denied
    outcome: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("insurance_claims_scheme_idx").on(t.schemeId)],
);
