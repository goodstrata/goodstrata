import { eventLog, lots, ownerships, people, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as lotsService from "../src/services/lots.js";
import * as ownershipsService from "../src/services/ownerships.js";

let tdb: TestDatabase;
let schemeId: string;
let otherSchemeId: string;
let otherSchemeLotId: string;
let otherSchemePersonId: string;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

const NOW = "2026-07-01T00:00:00Z";
const OFFICER = userActor("user-officer");

function ctxAt(iso: string, actor: Actor = OFFICER): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}

let lotCounter = 0;
async function newLot(inScheme = schemeId): Promise<string> {
  lotCounter += 1;
  const rows = await tdb.db
    .insert(lots)
    .values({
      schemeId: inScheme,
      lotNumber: `T${lotCounter}`,
      entitlement: 10,
      liability: 10,
    })
    .returning();
  return rows[0]!.id;
}

let personCounter = 0;
async function newPerson(inScheme = schemeId): Promise<string> {
  personCounter += 1;
  const rows = await tdb.db
    .insert(people)
    .values({
      schemeId: inScheme,
      givenName: `Person${personCounter}`,
      email: `person${personCounter}@example.com`,
    })
    .returning();
  return rows[0]!.id;
}

async function currentOwners(lotId: string) {
  return await tdb.db.query.ownerships.findMany({
    where: and(eq(ownerships.lotId, lotId), isNull(ownerships.endedOn)),
  });
}

async function lotEvents(lotId: string) {
  return await tdb.db
    .select({ type: eventLog.type, payload: eventLog.payload })
    .from(eventLog)
    .where(eq(eventLog.stream, `lot:${lotId}`))
    .orderBy(asc(eventLog.seq));
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values([
      {
        name: "Ownership Test OC",
        planOfSubdivision: "PS900001T",
        addressLine1: "9 Transfer St",
        suburb: "Brunswick",
        postcode: "3056",
        tier: 4,
        status: "active",
      },
      {
        name: "Other OC",
        planOfSubdivision: "PS900002T",
        addressLine1: "2 Elsewhere Rd",
        suburb: "Coburg",
        postcode: "3058",
        tier: 4,
        status: "active",
      },
    ])
    .returning();
  schemeId = rows[0]!.id;
  otherSchemeId = rows[1]!.id;
  otherSchemeLotId = await newLot(otherSchemeId);
  otherSchemePersonId = await newPerson(otherSchemeId);
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("addOwner", () => {
  it("records a current owner, defaults them to levy recipient, and publishes ownership.started", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const personId = await newPerson();

    const ownership = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId,
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    expect(ownership.isLevyRecipient).toBe(true);
    expect(ownership.startedOn).toBe("2026-07-01");
    expect(ownership.endedOn).toBeNull();

    const events = await lotEvents(lotId);
    expect(events).toEqual([
      {
        type: "ownership.started",
        payload: {
          ownershipId: ownership.id,
          lotId,
          personId,
          kind: "sole",
          shareNumerator: 1,
          shareDenominator: 1,
          isLevyRecipient: true,
          startedOn: "2026-07-01",
        },
      },
    ]);

    const register = await lotsService.listLots(ctx, schemeId);
    const owners = register.find((l) => l.id === lotId)!.owners;
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ personId, ownershipId: ownership.id, isLevyRecipient: true });
  });

  it("leaves the levy recipient with the existing holder when a co-owner joins", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const first = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const second = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    expect(second.isLevyRecipient).toBe(false);

    const recipients = (await currentOwners(lotId)).filter((o) => o.isLevyRecipient);
    expect(recipients.map((o) => o.id)).toEqual([first.id]);
  });

  it("demotes the current holder when the new owner explicitly takes the levy flag", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const taker = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
      isLevyRecipient: true,
    });

    const recipients = (await currentOwners(lotId)).filter((o) => o.isLevyRecipient);
    expect(recipients.map((o) => o.id)).toEqual([taker.id]);
  });

  it("rejects a person who already holds a current ownership, but allows re-adding after it ends", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const personId = await newPerson();
    const input = { personId, kind: "sole", shareNumerator: 1, shareDenominator: 1 } as const;

    const first = await ownershipsService.addOwner(ctx, schemeId, lotId, input);
    await expect(ownershipsService.addOwner(ctx, schemeId, lotId, input)).rejects.toMatchObject({
      code: "ALREADY_OWNER",
    });

    await ownershipsService.endOwnership(ctx, schemeId, lotId, first.id);
    const again = await ownershipsService.addOwner(ctx, schemeId, lotId, input);
    expect(again.id).not.toBe(first.id);
  });

  it("404s a person from another scheme and a lot from another scheme", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const personId = await newPerson();
    const input = { kind: "sole", shareNumerator: 1, shareDenominator: 1 } as const;

    await expect(
      ownershipsService.addOwner(ctx, schemeId, lotId, { ...input, personId: otherSchemePersonId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      ownershipsService.addOwner(ctx, schemeId, otherSchemeLotId, { ...input, personId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await currentOwners(otherSchemeLotId)).toHaveLength(0);
  });

  it("rejects fractional shares that oversubscribe the lot; whole 1/1 rows sit outside the sum", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const half = { kind: "joint", shareNumerator: 1, shareDenominator: 2 } as const;

    await ownershipsService.addOwner(ctx, schemeId, lotId, {
      ...half,
      personId: await newPerson(),
    });
    await ownershipsService.addOwner(ctx, schemeId, lotId, {
      ...half,
      personId: await newPerson(),
    });
    await expect(
      ownershipsService.addOwner(ctx, schemeId, lotId, {
        personId: await newPerson(),
        kind: "joint",
        shareNumerator: 1,
        shareDenominator: 4,
      }),
    ).rejects.toMatchObject({ code: "SHARES_EXCEED_WHOLE" });

    // A joint proprietor of the whole (1/1) can still join the fully
    // subscribed tenants-in-common register.
    await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    expect(await currentOwners(lotId)).toHaveLength(3);
  });
});

describe("endOwnership", () => {
  it("end-dates the row (never deletes), drops the owner from the register, and publishes ownership.ended", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const personId = await newPerson();
    const ownership = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId,
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
      startedOn: "2026-01-01",
    });

    const ended = await ownershipsService.endOwnership(ctx, schemeId, lotId, ownership.id, {
      endedOn: "2026-06-30",
    });
    expect(ended.endedOn).toBe("2026-06-30");

    // The row survives as history.
    const row = await tdb.db.query.ownerships.findFirst({
      where: eq(ownerships.id, ownership.id),
    });
    expect(row).toMatchObject({ personId, endedOn: "2026-06-30" });

    const register = await lotsService.listLots(ctx, schemeId);
    expect(register.find((l) => l.id === lotId)!.owners).toHaveLength(0);

    const events = await lotEvents(lotId);
    expect(events.at(-1)).toEqual({
      type: "ownership.ended",
      payload: {
        ownershipId: ownership.id,
        lotId,
        personId,
        endedOn: "2026-06-30",
        promotedLevyRecipientOwnershipId: null,
      },
    });
  });

  it("hands the levy flag to the longest-standing remaining owner when the recipient leaves", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const recipient = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
      startedOn: "2026-01-01",
    });
    const elder = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
      startedOn: "2026-02-01",
    });
    const younger = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
      startedOn: "2026-03-01",
    });

    await ownershipsService.endOwnership(ctx, schemeId, lotId, recipient.id);

    const remaining = await currentOwners(lotId);
    const recipients = remaining.filter((o) => o.isLevyRecipient);
    expect(recipients.map((o) => o.id)).toEqual([elder.id]);
    expect(remaining.find((o) => o.id === younger.id)!.isLevyRecipient).toBe(false);

    const events = await lotEvents(lotId);
    expect(events.at(-1)!.payload).toMatchObject({
      promotedLevyRecipientOwnershipId: elder.id,
    });
  });

  it("rejects an end date before the start date and 404s an already-ended row", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
      startedOn: "2026-05-01",
    });

    await expect(
      ownershipsService.endOwnership(ctx, schemeId, lotId, ownership.id, {
        endedOn: "2026-04-30",
      }),
    ).rejects.toMatchObject({ code: "ENDS_BEFORE_START" });

    await ownershipsService.endOwnership(ctx, schemeId, lotId, ownership.id);
    await expect(
      ownershipsService.endOwnership(ctx, schemeId, lotId, ownership.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setLevyRecipient", () => {
  it("moves the flag atomically — the lot never has two recipients — and publishes the change", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const first = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    const second = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "joint",
      shareNumerator: 1,
      shareDenominator: 1,
    });

    await ownershipsService.setLevyRecipient(ctx, schemeId, lotId, second.id);

    const recipients = (await currentOwners(lotId)).filter((o) => o.isLevyRecipient);
    expect(recipients.map((o) => o.id)).toEqual([second.id]);

    const events = await lotEvents(lotId);
    expect(events.at(-1)).toEqual({
      type: "lot.levy_recipient.changed",
      payload: {
        lotId,
        ownershipId: second.id,
        personId: second.personId,
        previousOwnershipId: first.id,
      },
    });
  });

  it("is a no-op on the current holder (no event published)", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });

    const before = (await lotEvents(lotId)).length;
    const result = await ownershipsService.setLevyRecipient(ctx, schemeId, lotId, ownership.id);
    expect(result.isLevyRecipient).toBe(true);
    expect(await lotEvents(lotId)).toHaveLength(before);
  });

  it("404s an ended ownership", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });
    await ownershipsService.endOwnership(ctx, schemeId, lotId, ownership.id);
    await expect(
      ownershipsService.setLevyRecipient(ctx, schemeId, lotId, ownership.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateOwnership", () => {
  it("corrects kind and share in place and publishes ownership.updated", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const ownership = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      personId: await newPerson(),
      kind: "sole",
      shareNumerator: 1,
      shareDenominator: 1,
    });

    const updated = await ownershipsService.updateOwnership(ctx, schemeId, lotId, ownership.id, {
      kind: "company_nominee",
      shareNumerator: 1,
      shareDenominator: 2,
    });
    expect(updated).toMatchObject({
      kind: "company_nominee",
      shareNumerator: 1,
      shareDenominator: 2,
    });

    const events = await lotEvents(lotId);
    expect(events.at(-1)).toEqual({
      type: "ownership.updated",
      payload: {
        ownershipId: ownership.id,
        lotId,
        personId: ownership.personId,
        kind: "company_nominee",
        shareNumerator: 1,
        shareDenominator: 2,
      },
    });
  });

  it("rejects a corrected share that would oversubscribe the lot with its co-owners", async () => {
    const ctx = ctxAt(NOW);
    const lotId = await newLot();
    const half = { kind: "joint", shareNumerator: 1, shareDenominator: 2 } as const;
    const target = await ownershipsService.addOwner(ctx, schemeId, lotId, {
      ...half,
      personId: await newPerson(),
    });
    await ownershipsService.addOwner(ctx, schemeId, lotId, {
      ...half,
      personId: await newPerson(),
    });

    await expect(
      ownershipsService.updateOwnership(ctx, schemeId, lotId, target.id, {
        shareNumerator: 3,
        shareDenominator: 4,
      }),
    ).rejects.toMatchObject({ code: "SHARES_EXCEED_WHOLE" });
  });

  it("validates the input shape: share halves must arrive together and can't exceed the whole", () => {
    expect(ownershipsService.updateOwnershipInput.safeParse({ shareNumerator: 1 }).success).toBe(
      false,
    );
    expect(
      ownershipsService.updateOwnershipInput.safeParse({ shareNumerator: 3, shareDenominator: 2 })
        .success,
    ).toBe(false);
    expect(
      ownershipsService.updateOwnershipInput.safeParse({ shareNumerator: 1, shareDenominator: 2 })
        .success,
    ).toBe(true);
  });
});
