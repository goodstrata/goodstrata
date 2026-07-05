import { people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { DomainError } from "../src/errors.js";
import * as grievances from "../src/services/grievances.js";

let tdb: TestDatabase;
let schemeId: string;
/** A person on the roll with no login attached (e.g. imported owner). */
let rollPersonId: string;
/** A person whose login is linked (people.userId = LINKED). */
let linkedPersonId: string;

/** A login with NO people row in the scheme — e.g. the scheme's creating owner. */
const UNLINKED = userActor("user-grv-unlinked");
const LINKED = "user-grv-linked";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

const NOW = "2026-07-01T00:00:00Z";

function ctx(actor: Actor = UNLINKED): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Grievance Test OC",
      planOfSubdivision: "PS888888G",
      addressLine1: "28 Dispute Dr",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 3,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values([
    { id: UNLINKED.id, name: "Creating Owner", email: "creator@example.com" },
    { id: LINKED, name: "Linked Owner", email: "linked@example.com" },
  ]);
  const inserted = await tdb.db
    .insert(people)
    .values([
      { schemeId, givenName: "Robin", familyName: "Roll", email: "robin@example.com" },
      {
        schemeId,
        givenName: "Lee",
        familyName: "Linked",
        email: "linked@example.com",
        userId: LINKED,
      },
    ])
    .returning();
  rollPersonId = inserted[0]!.id;
  linkedPersonId = inserted[1]!.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("fileComplaint", () => {
  it("lets a login with no people row file by naming the complainant explicitly", async () => {
    const complaint = await grievances.fileComplaint(ctx(), schemeId, {
      complainantPersonId: rollPersonId,
      subject: "Noise from lot 4 after 11pm",
      details: "Repeated loud music past midnight on 28 and 29 June.",
      approvedForm: true,
    });

    expect(complaint.complainantPersonId).toBe(rollPersonId);
    expect(complaint.status).toBe("received");
    // Statutory clock: received + 28 days.
    expect(complaint.meetByDate).toBe("2026-07-29");
  });

  it("returns an actionable 422 pointing at complainantPersonId when the login is unlinked and no complainant is named", async () => {
    const attempt = grievances.fileComplaint(ctx(), schemeId, {
      subject: "Bins left in the driveway",
      details: "Lot 2's bins block the shared driveway every week.",
      approvedForm: false,
    });

    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    await expect(attempt).rejects.toMatchObject({
      code: "NO_PERSON",
      status: 422,
      message: expect.stringContaining("choose who the complaint is from"),
      // Zod-issue-shaped details so form clients can attach the error to the
      // complainant field instead of dead-ending.
      details: [{ path: ["complainantPersonId"], message: expect.any(String) }],
    });
  });

  it("defaults the complainant to the filer's own person record when the login is linked", async () => {
    const complaint = await grievances.fileComplaint(ctx(userActor(LINKED)), schemeId, {
      subject: "Leaking common-property gutter",
      details: "Gutter above lot 6 overflows into the stairwell when it rains.",
      approvedForm: true,
    });

    expect(complaint.complainantPersonId).toBe(linkedPersonId);
  });

  it("rejects a named complainant who isn't a person in this scheme", async () => {
    const otherScheme = await tdb.db
      .insert(schemes)
      .values({
        name: "Other OC",
        planOfSubdivision: "PS888889G",
        addressLine1: "1 Elsewhere St",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 1,
        status: "active",
      })
      .returning();
    const stranger = await tdb.db
      .insert(people)
      .values({ schemeId: otherScheme[0]!.id, givenName: "Sam", email: "sam@example.com" })
      .returning();

    await expect(
      grievances.fileComplaint(ctx(), schemeId, {
        complainantPersonId: stranger[0]!.id,
        subject: "Cross-scheme complaint",
        details: "This should not be accepted.",
        approvedForm: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
