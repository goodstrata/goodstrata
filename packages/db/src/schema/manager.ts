import { bigint, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { documents } from "./documents.js";
import { organizations } from "./tenancy.js";

/**
 * Manager professional-indemnity insurance, tracked at the ORGANISATION level
 * (registered-manager path — OC Act s119(5) / reg 10 require ≥$2M PI cover held
 * continuously). One row per policy period; the compliance calendar raises a
 * `pi_expiry` obligation off the latest `expiresOn`, and continuity is checked
 * across successive rows via `effectiveOn`.
 */
export const managerPiPolicies = pgTable(
  "manager_pi_policies",
  {
    id: pk(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    insurer: text().notNull(),
    policyNumber: text().notNull(),
    /** Cover amount in cents; the ≥$2,000,000 statutory floor is checked in code. */
    coverAmountCents: bigint({ mode: "number" }).notNull(),
    /** Start of cover — used to prove continuous cover across renewals. */
    effectiveOn: date(),
    expiresOn: date().notNull(),
    /** The certificate of currency, if uploaded. */
    documentId: uuid().references(() => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("manager_pi_policies_org_idx").on(t.organizationId, t.expiresOn)],
);
