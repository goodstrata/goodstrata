import { ownerships, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as invitesService from "../src/services/invites.js";
import * as lotsService from "../src/services/lots.js";
import * as peopleService from "../src/services/people.js";

let tdb: TestDatabase;
let schemeId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const NOW = "2026-07-01T00:00:00Z";
const OFFICER = userActor("user-officer");

function ctxAt(iso: string, actor: Actor = OFFICER): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Roll Test OC",
      planOfSubdivision: "PS777777R",
      addressLine1: "7 Register Rd",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("createPersonInput", () => {
  it("rejects a person with no identifying details", () => {
    expect(peopleService.createPersonInput.safeParse({}).success).toBe(false);
    expect(peopleService.createPersonInput.safeParse({ phone: "0400 000 000" }).success).toBe(
      false,
    );
  });

  it("accepts a person with just an email", () => {
    expect(peopleService.createPersonInput.safeParse({ email: "o@example.com" }).success).toBe(
      true,
    );
  });
});

describe("people & lots roll", () => {
  it("imports lots with owners and links holdings on the people roll", async () => {
    const ctx = ctxAt(NOW);
    const result = await lotsService.importLotsCsv(
      ctx,
      schemeId,
      [
        "lot_number,entitlement,liability,lot_type,owner_name,owner_email",
        "1,20,20,residential,Alex Owner,alex@example.com",
        "2,10,10,residential,Billie Owner,billie@example.com",
      ].join("\n"),
    );
    expect(result.imported).toBe(2);
    expect(result.ownersCreated).toBe(2);

    const people = await peopleService.listPeople(ctx, schemeId);
    const alex = people.find((p) => p.email === "alex@example.com")!;
    expect(alex.lots.map((l) => l.lotNumber)).toEqual(["1"]);
    expect(alex.pendingInvite).toBe(false);
  });

  it("drops former owners from the lot register once their ownership is closed", async () => {
    const ctx = ctxAt(NOW);
    let lots = await lotsService.listLots(ctx, schemeId);
    const lot1 = lots.find((l) => l.lotNumber === "1")!;
    expect(lot1.owners).toHaveLength(1);

    // Transfer: close the current ownership period (history preserved).
    await tdb.db
      .update(ownerships)
      .set({ endedOn: "2026-06-30" })
      .where(eq(ownerships.lotId, lot1.id));

    lots = await lotsService.listLots(ctx, schemeId);
    expect(lots.find((l) => l.lotNumber === "1")!.owners).toHaveLength(0);

    // The former owner also no longer shows the lot on the people roll.
    const people = await peopleService.listPeople(ctx, schemeId);
    expect(people.find((p) => p.email === "alex@example.com")!.lots).toEqual([]);
  });

  it("treats an expired invite as no longer pending", async () => {
    const ctx = ctxAt(NOW);
    const people = await peopleService.listPeople(ctx, schemeId);
    const billie = people.find((p) => p.email === "billie@example.com")!;

    await invitesService.invitePerson(ctx, schemeId, billie.id, "owner", "http://localhost:3000");

    const fresh = await peopleService.listPeople(ctx, schemeId);
    expect(fresh.find((p) => p.id === billie.id)!.pendingInvite).toBe(true);

    // 15 days later the 14-day invite has lapsed — the person is invitable again.
    const later = ctxAt("2026-07-16T00:00:00Z");
    const lapsed = await peopleService.listPeople(later, schemeId);
    expect(lapsed.find((p) => p.id === billie.id)!.pendingInvite).toBe(false);
  });

  it("rejects a second person with the same email on the roll", async () => {
    const ctx = ctxAt(NOW);
    await expect(
      peopleService.createPerson(ctx, schemeId, {
        givenName: "Duplicate",
        email: "billie@example.com",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_PERSON" });
  });

  it("normalises empty-string contact fields to null on create", async () => {
    const ctx = ctxAt(NOW);
    const person = await peopleService.createPerson(ctx, schemeId, {
      givenName: "Casey",
      familyName: "",
      email: "casey@example.com",
      phone: "",
    });
    expect(person.familyName).toBeNull();
    expect(person.phone).toBeNull();
  });
});
