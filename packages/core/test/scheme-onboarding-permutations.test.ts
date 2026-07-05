/**
 * Permutation coverage for the scheme onboarding & core registers family:
 * scheme creation, lot import (CSV), people roll, invites, committee
 * assignment and activation — exercised at the service layer with real
 * Postgres, per docs/SPEC.md invariants (roles, validation, error codes).
 */
import { funds, memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, agentActor, fixedClock, userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { DomainError } from "../src/errors.js";
import * as committeeService from "../src/services/committee.js";
import * as documentsService from "../src/services/documents.js";
import * as invitesService from "../src/services/invites.js";
import * as lotsService from "../src/services/lots.js";
import * as onboardingService from "../src/services/onboarding.js";
import * as peopleService from "../src/services/people.js";
import * as schemesService from "../src/services/schemes.js";

let tdb: TestDatabase;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const NOW = "2026-07-04T00:00:00Z";
const MANAGER = userActor("perm-user-manager");

function ctxAt(iso: string, actor: Actor = MANAGER): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}
const ctx = (actor: Actor = MANAGER) => ctxAt(NOW, actor);

/** Insert a bare scheme row (bypasses createScheme, like the register tests do). */
async function seedScheme(plan: string) {
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: `Scheme ${plan}`,
      planOfSubdivision: plan,
      addressLine1: "1 Test St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 5,
    })
    .returning();
  return rows[0]!;
}

async function expectDomainError(
  promise: Promise<unknown>,
  code: string,
  status: number,
): Promise<DomainError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  const de = err as DomainError;
  expect(de.code).toBe(code);
  expect(de.status).toBe(status);
  return de;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  // memberships.userId has an FK to users, so every actor that ends up in a
  // membership row needs a real login identity.
  await tdb.db.insert(users).values([
    { id: "perm-user-manager", name: "Morgan Manager", email: "perm-manager@example.com" },
    { id: "perm-user-alex", name: "Alex Owner", email: "perm-alex@example.com" },
    { id: "perm-user-billie", name: "Billie Owner", email: "perm-billie@example.com" },
  ]);
});

afterAll(async () => {
  await tdb.cleanup();
});

// ---------------------------------------------------------------------------
// Scheme creation
// ---------------------------------------------------------------------------

describe("createSchemeInput validation", () => {
  const base = {
    name: "48 Rose St Owners Corporation",
    addressLine1: "48 Rose Street",
    suburb: "Fitzroy",
    postcode: "3065",
  };
  const parse = (over: Record<string, string>) =>
    schemesService.createSchemeInput.safeParse({
      ...base,
      planOfSubdivision: "PS543210V",
      ...over,
    });

  it("accepts plan numbers with 4-7 digits and an optional check letter, case-insensitively", () => {
    expect(parse({ planOfSubdivision: "PS12345" }).success).toBe(true);
    expect(parse({ planOfSubdivision: "PS1234567" }).success).toBe(true);
    expect(parse({ planOfSubdivision: "ps543210v" }).success).toBe(true);
  });

  it("rejects non-PS plan prefixes and too-short digit runs", () => {
    expect(parse({ planOfSubdivision: "LP12345" }).success).toBe(false);
    expect(parse({ planOfSubdivision: "PS123" }).success).toBe(false);
    expect(parse({ planOfSubdivision: "PS543210VV" }).success).toBe(false);
  });

  it("requires exactly four postcode digits", () => {
    expect(parse({ postcode: "300" }).success).toBe(false);
    expect(parse({ postcode: "30000" }).success).toBe(false);
    expect(parse({ postcode: "3000" }).success).toBe(true);
    expect(parse({ postcode: "3O65" }).success).toBe(false);
  });

  it("requires a name and address line", () => {
    expect(parse({ name: "" }).success).toBe(false);
    expect(parse({ addressLine1: "" }).success).toBe(false);
  });

  it("defaults state to VIC", () => {
    const parsed = schemesService.createSchemeInput.parse({
      ...base,
      planOfSubdivision: "PS543210V",
    });
    expect(parsed.state).toBe("VIC");
  });
});

describe("createScheme", () => {
  const input = {
    name: "Acacia Lane OC",
    planOfSubdivision: "ps600111k", // lowercase on purpose
    addressLine1: "12 Acacia Lane",
    suburb: "Brunswick",
    state: "VIC",
    postcode: "3056",
  };

  it("refuses non-user actors — a scheme must have a human founder", async () => {
    await expectDomainError(
      schemesService.createScheme(ctx(agentActor("finance", "run-1")), input),
      "FORBIDDEN",
      403,
    );
  });

  it("creates the scheme in onboarding status with both statutory funds and a manager_admin founder", async () => {
    const scheme = await schemesService.createScheme(ctx(), input);

    // Plan number is normalised to uppercase on the register.
    expect(scheme.planOfSubdivision).toBe("PS600111K");
    expect(scheme.status).toBe("onboarding");
    expect(scheme.tier).toBe(5); // zero lots so far

    const fundRows = await tdb.db.query.funds.findMany({
      where: eq(funds.schemeId, scheme.id),
    });
    expect(fundRows.map((f) => f.kind).sort()).toEqual(["admin", "maintenance"]);

    const roles = await schemesService.rolesForUser(ctx(), scheme.id, "perm-user-manager");
    expect(roles).toEqual(["manager_admin"]);
    // A different user holds no roles → API-level scheme scoping 404s them.
    expect(await schemesService.rolesForUser(ctx(), scheme.id, "perm-user-alex")).toEqual([]);
  });

  it("rejects a duplicate plan of subdivision even in a different case", async () => {
    await expectDomainError(
      schemesService.createScheme(ctx(), { ...input, name: "Copycat OC" }),
      "SCHEME_EXISTS",
      409,
    );
    await expectDomainError(
      schemesService.createScheme(ctx(), { ...input, planOfSubdivision: "PS600111K" }),
      "SCHEME_EXISTS",
      409,
    );
  });
});

// ---------------------------------------------------------------------------
// Lot import (CSV)
// ---------------------------------------------------------------------------

describe("importLotsCsv", () => {
  it("rejects a CSV with no data rows", async () => {
    const scheme = await seedScheme("PS700001A");
    await expectDomainError(
      lotsService.importLotsCsv(ctx(), scheme.id, "lot_number,entitlement,liability"),
      "EMPTY_IMPORT",
      400,
    );
  });

  it("reports every bad line in the INVALID_IMPORT envelope and imports nothing", async () => {
    const scheme = await seedScheme("PS700002B");
    const csv = [
      "lot_number,entitlement,liability",
      "1,10,10",
      "2,zero,10", // entitlement not a number
      "3,10,-5", // negative liability
    ].join("\n");

    const err = await expectDomainError(
      lotsService.importLotsCsv(ctx(), scheme.id, csv),
      "INVALID_IMPORT",
      422,
    );
    const details = err.details as { errors: { line: number; message: string }[] };
    // Header is line 1, so the bad rows are lines 3 and 4.
    expect(details.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(details.errors[0]!.message).toContain("entitlement");
    expect(details.errors[1]!.message).toContain("liability");

    // All-or-nothing: the valid line 2 must not have been imported either.
    expect(await lotsService.listLots(ctx(), scheme.id)).toHaveLength(0);
  });

  it("rejects a duplicate lot_number within one CSV", async () => {
    const scheme = await seedScheme("PS700003C");
    const csv = ["lot_number,entitlement,liability", "1,10,10", "1,20,20"].join("\n");
    await expectDomainError(lotsService.importLotsCsv(ctx(), scheme.id, csv), "DUPLICATE_LOT", 422);
    expect(await lotsService.listLots(ctx(), scheme.id)).toHaveLength(0);
  });

  it("imports lots, creates owners from owner columns, and recalculates the tier from occupiable lots", async () => {
    const scheme = await seedScheme("PS700004D");
    const csv = [
      "lot_number,entitlement,liability,lot_type,owner_name,owner_email",
      "1,20,20,commercial,Sam Shopkeeper,sam@example.com",
      "2,10,10,residential,Alex Owner,alex@example.com",
      "3,10,10,residential,,", // no owner columns → lot only
      "C1,1,1,carpark,,", // accessory: never counts toward the tier
    ].join("\n");

    const result = await lotsService.importLotsCsv(ctx(), scheme.id, csv);
    expect(result).toEqual({ imported: 4, ownersCreated: 2, errors: [] });

    const register = await lotsService.listLots(ctx(), scheme.id);
    expect(register.map((l) => l.lotNumber).sort()).toEqual(["1", "2", "3", "C1"]);
    const lot1 = register.find((l) => l.lotNumber === "1")!;
    expect(lot1.owners).toHaveLength(1);
    expect(lot1.owners[0]).toMatchObject({
      givenName: "Sam",
      familyName: "Shopkeeper",
      email: "sam@example.com",
    });
    expect(register.find((l) => l.lotNumber === "3")!.owners).toEqual([]);

    // 3 occupiable lots (carpark excluded) → tier 4, not tier 3-adjacent noise.
    const updated = await tdb.db.query.schemes.findFirst({ where: eq(schemes.id, scheme.id) });
    expect(updated!.tier).toBe(4);
  });

  it("rejects a re-import whose lot_number already exists and leaves the register untouched", async () => {
    const scheme = await seedScheme("PS700005E");
    await lotsService.importLotsCsv(
      ctx(),
      scheme.id,
      ["lot_number,entitlement,liability", "1,10,10"].join("\n"),
    );

    // NOTE: re-import is a hard 409, not an idempotent update — existing lots
    // are matched by lot number and refused (all-or-nothing, so the new lot 2
    // in the same CSV must roll back too).
    await expectDomainError(
      lotsService.importLotsCsv(
        ctx(),
        scheme.id,
        ["lot_number,entitlement,liability", "1,15,15", "2,10,10"].join("\n"),
      ),
      "DUPLICATE_LOT",
      409,
    );

    const register = await lotsService.listLots(ctx(), scheme.id);
    expect(register).toHaveLength(1);
    expect(register[0]).toMatchObject({ lotNumber: "1", entitlement: 10, liability: 10 });
  });

  it("coerces an unknown lot_type to residential rather than failing the row", async () => {
    const scheme = await seedScheme("PS700006F");
    await lotsService.importLotsCsv(
      ctx(),
      scheme.id,
      ["lot_number,entitlement,liability,lot_type", "1,10,10,penthouse"].join("\n"),
    );
    const register = await lotsService.listLots(ctx(), scheme.id);
    expect(register[0]!.lotType).toBe("residential");
  });
});

// ---------------------------------------------------------------------------
// People roll
// ---------------------------------------------------------------------------

describe("createPerson permutations", () => {
  it("requires at least a name, company or email — and pins the error to givenName", () => {
    const parsed = peopleService.createPersonInput.safeParse({ phone: "0400 000 000" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]!.path).toEqual(["givenName"]);
    }
    expect(peopleService.createPersonInput.safeParse({ familyName: "Ng" }).success).toBe(true);
    expect(peopleService.createPersonInput.safeParse({ companyName: "Lots R Us" }).success).toBe(
      true,
    );
    expect(peopleService.createPersonInput.safeParse({ email: "solo@example.com" }).success).toBe(
      true,
    );
  });

  it("normalises omitted fields to null on the roll", async () => {
    const scheme = await seedScheme("PS700010A");
    const person = await peopleService.createPerson(ctx(), scheme.id, { givenName: "Nameless" });
    expect(person.familyName).toBeNull();
    expect(person.email).toBeNull();
    expect(person.phone).toBeNull();
  });

  it("refuses a second roll entry for the same email in the same scheme, but allows it in another scheme", async () => {
    const schemeA = await seedScheme("PS700011B");
    const schemeB = await seedScheme("PS700012C");
    await peopleService.createPerson(ctx(), schemeA.id, { email: "dup@example.com" });
    await expectDomainError(
      peopleService.createPerson(ctx(), schemeA.id, {
        givenName: "Other",
        email: "dup@example.com",
      }),
      "DUPLICATE_PERSON",
      409,
    );
    // Scheme scoping: the same address on a different roll is fine.
    const other = await peopleService.createPerson(ctx(), schemeB.id, {
      email: "dup@example.com",
    });
    expect(other.schemeId).toBe(schemeB.id);
  });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

describe("invitePerson / acceptInvite permutations", () => {
  const APP_URL = "http://localhost:5273";

  it("never grants manager_admin via an invite", async () => {
    const scheme = await seedScheme("PS700020A");
    const person = await peopleService.createPerson(ctx(), scheme.id, {
      email: "escalate@example.com",
    });
    await expectDomainError(
      invitesService.invitePerson(ctx(), scheme.id, person.id, "manager_admin", APP_URL),
      "INVALID_ROLE",
      422,
    );
  });

  it("refuses to invite a person with no email address", async () => {
    const scheme = await seedScheme("PS700021B");
    const person = await peopleService.createPerson(ctx(), scheme.id, { givenName: "NoEmail" });
    await expectDomainError(
      invitesService.invitePerson(ctx(), scheme.id, person.id, "owner", APP_URL),
      "NO_EMAIL",
      422,
    );
  });

  it("404s a person from another scheme (no cross-scheme invites)", async () => {
    const schemeA = await seedScheme("PS700022C");
    const schemeB = await seedScheme("PS700023D");
    const person = await peopleService.createPerson(ctx(), schemeA.id, {
      email: "elsewhere@example.com",
    });
    await expectDomainError(
      invitesService.invitePerson(ctx(), schemeB.id, person.id, "owner", APP_URL),
      "NOT_FOUND",
      404,
    );
  });

  it("issues a 14-day invite, marks the person pending, and expires on time", async () => {
    const scheme = await seedScheme("PS700024E");
    const person = await peopleService.createPerson(ctx(), scheme.id, {
      givenName: "Billie",
      email: "perm-billie@example.com",
    });

    const { token, expiresAt } = await invitesService.invitePerson(
      ctx(),
      scheme.id,
      person.id,
      "owner",
      APP_URL,
    );
    expect(expiresAt.toISOString()).toBe("2026-07-18T00:00:00.000Z"); // NOW + 14 days

    const roll = await peopleService.listPeople(ctx(), scheme.id);
    expect(roll.find((p) => p.id === person.id)!.pendingInvite).toBe(true);

    // Day 15: the invite has lapsed for both preview and acceptance.
    const later = ctxAt("2026-07-19T00:00:00Z", userActor("perm-user-billie"));
    await expectDomainError(invitesService.previewInvite(later, token), "INVALID_INVITE", 410);
    await expectDomainError(invitesService.acceptInvite(later, token), "INVALID_INVITE", 410);
  });

  it("accepting links the login, creates the membership once, and burns the token", async () => {
    const scheme = await seedScheme("PS700025F");
    const person = await peopleService.createPerson(ctx(), scheme.id, {
      givenName: "Alex",
      email: "perm-alex@example.com",
    });
    const { token } = await invitesService.invitePerson(
      ctx(),
      scheme.id,
      person.id,
      "owner",
      APP_URL,
    );

    // Only a signed-in user can accept.
    await expectDomainError(
      invitesService.acceptInvite(ctx(agentActor("finance", "run-2")), token),
      "FORBIDDEN",
      403,
    );

    const asAlex = ctx(userActor("perm-user-alex"));
    const result = await invitesService.acceptInvite(asAlex, token);
    expect(result.schemeId).toBe(scheme.id);

    expect(await schemesService.rolesForUser(ctx(), scheme.id, "perm-user-alex")).toEqual([
      "owner",
    ]);
    const roll = await peopleService.listPeople(ctx(), scheme.id);
    expect(roll.find((p) => p.id === person.id)).toMatchObject({
      userId: "perm-user-alex",
      pendingInvite: false,
    });

    // One-time token: a replay is refused.
    await expectDomainError(invitesService.acceptInvite(asAlex, token), "INVALID_INVITE", 410);
  });
});

// ---------------------------------------------------------------------------
// Committee
// ---------------------------------------------------------------------------

describe("assignCommitteeRole permutations", () => {
  it("only accepts committee roles", async () => {
    const scheme = await seedScheme("PS700030A");
    for (const bad of ["owner", "manager_admin", "tenant"] as const) {
      await expectDomainError(
        committeeService.assignCommitteeRole(ctx(), scheme.id, "perm-user-alex", bad),
        "INVALID_ROLE",
        422,
      );
    }
  });

  it("statutory offices are single-holder: appointing a new chair closes the incumbent, never deletes them", async () => {
    const scheme = await seedScheme("PS700031B");
    await committeeService.assignCommitteeRole(ctx(), scheme.id, "perm-user-alex", "chair");
    await committeeService.assignCommitteeRole(ctx(), scheme.id, "perm-user-billie", "chair");

    const active = await committeeService.listCommittee(ctx(), scheme.id);
    const chairs = active.filter((m) => m.role === "chair");
    expect(chairs).toHaveLength(1);
    expect(chairs[0]!.userId).toBe("perm-user-billie");

    // History is the register: Alex's chair period survives with endedOn set.
    const closed = await tdb.db.query.memberships.findMany({
      where: and(
        eq(memberships.schemeId, scheme.id),
        eq(memberships.userId, "perm-user-alex"),
        eq(memberships.role, "chair"),
      ),
    });
    expect(closed).toHaveLength(1);
    expect(closed[0]!.endedOn).not.toBeNull();
  });

  it("committee_member is multi-holder and re-assignment is idempotent", async () => {
    const scheme = await seedScheme("PS700032C");
    await committeeService.assignCommitteeRole(
      ctx(),
      scheme.id,
      "perm-user-alex",
      "committee_member",
    );
    await committeeService.assignCommitteeRole(
      ctx(),
      scheme.id,
      "perm-user-billie",
      "committee_member",
    );
    // Repeat assignment must not duplicate the active membership.
    await committeeService.assignCommitteeRole(
      ctx(),
      scheme.id,
      "perm-user-alex",
      "committee_member",
    );

    const active = await committeeService.listCommittee(ctx(), scheme.id);
    const members = active.filter((m) => m.role === "committee_member");
    expect(members.map((m) => m.userId).sort()).toEqual(["perm-user-alex", "perm-user-billie"]);
  });

  it("committee_member is NOT an officer tier for the API/UI gates (mirrors apps/web OFFICER_ROLES)", () => {
    // The documents tier helper is core's single source of truth for what a
    // committee_member unlocks: record access, not officer powers. The officer
    // gate itself (requireRole) is asserted in apps/api tests.
    expect(documentsService.accessLevelsForRoles(["committee_member"])).toEqual([
      "owners",
      "committee",
      "admin",
    ]);
    expect(documentsService.accessLevelsForRoles(["owner"])).toEqual(["owners"]);
  });
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe("activation gate permutations", () => {
  it("walks the checklist: no lots → no insurance → ready → active → already-active", async () => {
    const scheme = await seedScheme("PS700040A");

    // Fresh scheme: nothing done.
    expect(await onboardingService.onboardingStatus(ctx(), scheme.id)).toEqual({
      hasLots: false,
      hasInsurance: false,
      ready: false,
      status: "onboarding",
    });
    await expectDomainError(onboardingService.activateScheme(ctx(), scheme.id), "NO_LOTS", 422);

    // Lots imported, still no insurance certificate.
    await lotsService.importLotsCsv(
      ctx(),
      scheme.id,
      ["lot_number,entitlement,liability", "1,50,50", "2,50,50"].join("\n"),
    );
    expect(await onboardingService.onboardingStatus(ctx(), scheme.id)).toMatchObject({
      hasLots: true,
      hasInsurance: false,
      ready: false,
    });
    await expectDomainError(
      onboardingService.activateScheme(ctx(), scheme.id),
      "NO_INSURANCE",
      422,
    );

    // A non-insurance document does not satisfy the insurance step.
    await documentsService.uploadDocument(ctx(), scheme.id, {
      filename: "minutes.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 minutes"),
      category: "minutes",
    });
    expect((await onboardingService.onboardingStatus(ctx(), scheme.id)).hasInsurance).toBe(false);

    await documentsService.uploadDocument(ctx(), scheme.id, {
      filename: "certificate-of-currency.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.4 cover"),
      category: "insurance",
    });
    expect(await onboardingService.onboardingStatus(ctx(), scheme.id)).toMatchObject({
      ready: true,
      status: "onboarding",
    });

    await onboardingService.activateScheme(ctx(), scheme.id);
    expect((await onboardingService.onboardingStatus(ctx(), scheme.id)).status).toBe("active");

    // Activation is not idempotent: the second press is a 409 the UI surfaces inline.
    await expectDomainError(
      onboardingService.activateScheme(ctx(), scheme.id),
      "ALREADY_ACTIVE",
      409,
    );
  });

  it("404s an unknown scheme", async () => {
    await expectDomainError(
      onboardingService.onboardingStatus(ctx(), "00000000-0000-0000-0000-000000000000"),
      "NOT_FOUND",
      404,
    );
  });
});

// ---------------------------------------------------------------------------
// Document access tiers (s146) — the owner-vs-committee read fence
// ---------------------------------------------------------------------------

describe("document access tiers on the register", () => {
  it("an owner-tier listing excludes committee/admin records entirely", async () => {
    const scheme = await seedScheme("PS700050A");
    for (const accessLevel of ["owners", "committee", "admin"] as const) {
      await documentsService.uploadDocument(ctx(), scheme.id, {
        filename: `${accessLevel}.txt`,
        contentType: "text/plain",
        content: new TextEncoder().encode(`tier ${accessLevel}`),
        category: "other",
        accessLevel,
      });
    }

    const ownerView = await documentsService.listDocuments(
      ctx(),
      scheme.id,
      undefined,
      documentsService.accessLevelsForRoles(["owner"]),
    );
    expect(ownerView.map((d) => d.accessLevel)).toEqual(["owners"]);

    const officerView = await documentsService.listDocuments(
      ctx(),
      scheme.id,
      undefined,
      documentsService.accessLevelsForRoles(["secretary"]),
    );
    expect(officerView.map((d) => d.accessLevel).sort()).toEqual(["admin", "committee", "owners"]);
  });
});
