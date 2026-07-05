/**
 * Permutation coverage for manager registration & PI insurance capture
 * (registered-manager path: BLA registration + ≥$2M PI floor, reg 10).
 * Complements compliance.test.ts, which unit-tests isContinuous/escalation.
 */
import { complianceObligations, organizations } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { DomainError } from "../src/errors.js";
import * as reg from "../src/services/managerRegistration.js";

let tdb: TestDatabase;
let orgId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const NOW = "2026-07-04T00:00:00Z";
const TODAY = "2026-07-04";
const ADMIN = userActor("mr-admin");

function ctxAt(iso: string, actor: Actor = ADMIN): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}
const ctx = () => ctxAt(NOW);

const MISSING_ORG = "00000000-0000-0000-0000-000000000000";

async function freshOrg(name: string) {
  const rows = await tdb.db.insert(organizations).values({ name }).returning();
  return rows[0]!.id;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  orgId = await freshOrg("Good Strata Pty Ltd");
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("recordRegistrationInput validation", () => {
  it("requires a non-empty registration number and an ISO date-only review date", () => {
    expect(
      reg.recordRegistrationInput.safeParse({ registrationNumber: "", expiresOn: "2027-06-30" })
        .success,
    ).toBe(false);
    expect(
      reg.recordRegistrationInput.safeParse({ registrationNumber: "BLA-1", expiresOn: "2027-6-3" })
        .success,
    ).toBe(false);
    expect(
      reg.recordRegistrationInput.safeParse({
        registrationNumber: "BLA-1",
        expiresOn: "2027-06-30T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      reg.recordRegistrationInput.safeParse({
        registrationNumber: "BLA-1",
        expiresOn: "2027-06-30",
      }).success,
    ).toBe(true);
  });
});

describe("recordManagerRegistration", () => {
  it("404s an unknown organisation", async () => {
    await expect(
      reg.recordManagerRegistration(ctx(), MISSING_ORG, {
        registrationNumber: "BLA-404",
        expiresOn: "2027-06-30",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("persists the number on the org and raises a registration_renewal obligation off the review date", async () => {
    const result = await reg.recordManagerRegistration(ctx(), orgId, {
      registrationNumber: "BLA-2026-001",
      expiresOn: "2027-06-30",
    });
    expect(result.organization.managerRegistrationNumber).toBe("BLA-2026-001");

    const obligation = await tdb.db.query.complianceObligations.findFirst({
      where: eq(complianceObligations.id, result.obligationId),
    });
    expect(obligation).toMatchObject({
      organizationId: orgId,
      kind: "registration_renewal",
      dueOn: "2027-06-30",
      subjectRef: "registration",
    });
  });

  it("re-recording within the same review year is idempotent on the obligation but updates the number", async () => {
    const first = await reg.recordManagerRegistration(ctx(), orgId, {
      registrationNumber: "BLA-2026-001",
      expiresOn: "2027-06-30",
    });
    const renewed = await reg.recordManagerRegistration(ctx(), orgId, {
      registrationNumber: "BLA-2026-002",
      expiresOn: "2027-07-31",
    });
    // Same periodKey (2027) → deduped to the one obligation.
    expect(renewed.obligationId).toBe(first.obligationId);
    expect(renewed.organization.managerRegistrationNumber).toBe("BLA-2026-002");
  });
});

describe("recordPiPolicy — the ≥$2M floor is deterministic cents math", () => {
  const base = {
    insurer: "Assurance Co",
    policyNumber: "PI-0001",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
  };

  it("rejects zero, negative and fractional-cent cover amounts at the schema", () => {
    for (const coverAmountCents of [0, -1, 1999999.5]) {
      expect(reg.recordPiPolicyInput.safeParse({ ...base, coverAmountCents }).success).toBe(false);
    }
    expect(reg.recordPiPolicyInput.safeParse({ ...base, coverAmountCents: 1 }).success).toBe(true);
  });

  it("effectiveOn is optional but must be date-only when given", () => {
    const { effectiveOn: _drop, ...noEffective } = base;
    expect(reg.recordPiPolicyInput.safeParse({ ...noEffective, coverAmountCents: 1 }).success).toBe(
      true,
    );
    expect(
      reg.recordPiPolicyInput.safeParse({
        ...base,
        effectiveOn: "01/01/2026",
        coverAmountCents: 1,
      }).success,
    ).toBe(false);
  });

  it("404s an unknown organisation before writing anything", async () => {
    await expect(
      reg.recordPiPolicy(ctx(), MISSING_ORG, { ...base, coverAmountCents: reg.MIN_PI_COVER_CENTS }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("records under-floor cover but flags it insufficient ($19,999.99 → warning path)", async () => {
    const under = await reg.recordPiPolicy(ctx(), orgId, {
      ...base,
      policyNumber: "PI-UNDER",
      // The UI's dollars→cents conversion: 19,999.99 dollars × 100.
      coverAmountCents: 1_999_999,
    });
    expect(under.coverSufficient).toBe(false);
    expect(under.policy.coverAmountCents).toBe(1_999_999); // recorded, not rejected

    const boundaryBelow = await reg.recordPiPolicy(ctx(), orgId, {
      ...base,
      policyNumber: "PI-1-CENT-SHORT",
      coverAmountCents: reg.MIN_PI_COVER_CENTS - 1,
    });
    expect(boundaryBelow.coverSufficient).toBe(false);
  });

  it("exactly $2,000,000 satisfies the floor and raises a pi_expiry obligation per policy", async () => {
    const result = await reg.recordPiPolicy(ctx(), orgId, {
      ...base,
      policyNumber: "PI-FLOOR",
      coverAmountCents: reg.MIN_PI_COVER_CENTS,
    });
    expect(result.coverSufficient).toBe(true);

    const obligation = await tdb.db.query.complianceObligations.findFirst({
      where: eq(complianceObligations.id, result.obligationId),
    });
    expect(obligation).toMatchObject({
      organizationId: orgId,
      kind: "pi_expiry",
      dueOn: base.expiresOn,
      subjectRef: `pi_policy:${result.policy.id}`,
    });
  });
});

describe("getRegistrationStatus boundaries", () => {
  it("a policy expiring today still counts; yesterday does not", async () => {
    // Fresh orgs so the shared fixture's policies don't interfere.
    const orgToday = await freshOrg("Expires Today Pty Ltd");
    await reg.recordPiPolicy(ctx(), orgToday, {
      insurer: "Assurance Co",
      policyNumber: "PI-TODAY",
      coverAmountCents: reg.MIN_PI_COVER_CENTS,
      effectiveOn: "2025-07-05",
      expiresOn: TODAY,
    });
    const statusToday = await reg.getRegistrationStatus(ctx(), orgToday);
    expect(statusToday.piCoverSufficient).toBe(true);
    expect(statusToday.piContinuous).toBe(true);

    const orgLapsed = await freshOrg("Lapsed Pty Ltd");
    await reg.recordPiPolicy(ctx(), orgLapsed, {
      insurer: "Assurance Co",
      policyNumber: "PI-YESTERDAY",
      coverAmountCents: reg.MIN_PI_COVER_CENTS,
      effectiveOn: "2025-07-04",
      expiresOn: "2026-07-03",
    });
    const statusLapsed = await reg.getRegistrationStatus(ctx(), orgLapsed);
    // A lapsed policy, however large, evidences nothing (reg 10).
    expect(statusLapsed.piCoverSufficient).toBe(false);
    expect(statusLapsed.piContinuous).toBe(false);
    expect(statusLapsed.currentPiPolicy?.policyNumber).toBe("PI-YESTERDAY");
  });

  it("an in-force but under-floor policy is not sufficient cover", async () => {
    const org = await freshOrg("Underinsured Pty Ltd");
    await reg.recordPiPolicy(ctx(), org, {
      insurer: "Assurance Co",
      policyNumber: "PI-THIN",
      coverAmountCents: 1_999_999,
      effectiveOn: "2026-01-01",
      expiresOn: "2026-12-31",
    });
    const status = await reg.getRegistrationStatus(ctx(), org);
    expect(status.piCoverSufficient).toBe(false);
    expect(status.piContinuous).toBe(true); // continuity is about dates, not amount
  });

  it("404s an unknown organisation", async () => {
    const err = await reg.getRegistrationStatus(ctx(), MISSING_ORG).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).status).toBe(404);
  });
});
