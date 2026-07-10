import { createHmac, randomUUID } from "node:crypto";
import { lots, memberships, ownerships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as notifierService from "../src/services/notifier.js";
import * as unsubscribeService from "../src/services/unsubscribe.js";

/**
 * The per-recipient unsubscribe loop end to end:
 *   token mint → verify (tamper-proof) → applyUnsubscribe flips the email pref
 *   → the notifier stops emailing that user for that type (bell keeps ringing)
 *   → notifier emails carry the personal unsubscribe URL in body and header.
 */

const SECRET = "test-unsubscribe-secret";

let tdb: TestDatabase;
let schemeId: string;
let lotId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
    UNSUBSCRIBE_SECRET: SECRET,
    APP_URL: "https://my.goodstrata.test",
  }),
  payments: mockPaymentsProvider(),
};
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string; listUnsubscribeUrl?: string }[];
};

const NOW = "2026-07-02T00:00:00Z";
function ctxAs(actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

const OWNER = "user-owner-unsub";

function fakeEvent(type: string, payload: unknown): EventRecord {
  return {
    id: randomUUID(),
    seq: 0,
    schemeId,
    stream: "test",
    type,
    payload,
    actor: systemActor("test"),
    correlationId: randomUUID(),
    causationId: null,
    causationDepth: 0,
    occurredAt: new Date(NOW),
  };
}

function levyEvent() {
  return fakeEvent("levy.notice.issued", {
    levyNoticeId: randomUUID(),
    lotId,
    noticeNumber: `LN-UNSUB-${randomUUID().slice(0, 8)}`,
    totalCents: 100_000,
    dueOn: "2026-08-01",
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Unsub Test OC",
      planOfSubdivision: "PS666666U",
      addressLine1: "6 Optout Ln",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values({
    id: OWNER,
    name: "Olly Optout",
    email: "owner-unsub@example.com",
  });
  await tdb.db.insert(memberships).values({
    schemeId,
    userId: OWNER,
    role: "owner",
    startedOn: "2025-01-01",
  });
  const ownerPerson = await tdb.db
    .insert(people)
    .values({
      schemeId,
      userId: OWNER,
      givenName: "Olly",
      familyName: "Optout",
      email: "owner-unsub@example.com",
    })
    .returning();
  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 })
    .returning();
  lotId = lotRows[0]!.id;
  await tdb.db.insert(ownerships).values({
    schemeId,
    lotId,
    personId: ownerPerson[0]!.id,
    startedOn: "2025-01-01",
  });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("unsubscribe tokens", () => {
  it("round-trips: mint → verify returns the claims", () => {
    const token = unsubscribeService.createUnsubscribeToken(SECRET, OWNER, "levy.notice.issued");
    const claims = unsubscribeService.verifyUnsubscribeToken(SECRET, token);
    expect(claims).toEqual({ userId: OWNER, notificationType: "levy.notice.issued" });
  });

  it("rejects tampering, wrong secrets, junk, and unknown types", () => {
    const token = unsubscribeService.createUnsubscribeToken(SECRET, OWNER, "levy.notice.issued");
    // Signed with a different secret → dead.
    expect(unsubscribeService.verifyUnsubscribeToken("other-secret", token)).toBeNull();
    // Payload swap keeps the old signature → dead.
    const forgedPayload = Buffer.from(
      JSON.stringify({ u: "someone-else", t: "levy.notice.issued" }),
      "utf8",
    ).toString("base64url");
    const sig = token.split(".")[1]!;
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, `${forgedPayload}.${sig}`)).toBeNull();
    // Structural junk.
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, "")).toBeNull();
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, "a.b.c")).toBeNull();
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, "not-a-token")).toBeNull();
    // A correctly-signed token for a type outside the registry never verifies
    // (nothing to flip).
    const badPayload = Buffer.from(JSON.stringify({ u: OWNER, t: "nope.nope" }), "utf8").toString(
      "base64url",
    );
    const badSig = createHmac("sha256", SECRET).update(badPayload).digest().toString("base64url");
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, `${badPayload}.${badSig}`)).toBeNull();
  });

  it("builds a per-recipient URL that embeds the token", () => {
    const url = unsubscribeService.unsubscribeUrl(
      "https://my.goodstrata.test/",
      SECRET,
      OWNER,
      "levy.notice.issued",
    );
    expect(url).toMatch(/^https:\/\/my\.goodstrata\.test\/api\/unsubscribe\?token=/);
    const token = decodeURIComponent(url.split("token=")[1]!);
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, token)?.userId).toBe(OWNER);
  });
});

describe("unsubscribe end to end through the notifier", () => {
  it("notifier email carries the personal unsubscribe URL (footer + header)", async () => {
    memoryEmail.sent.length = 0;
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      levyEvent(),
    );
    expect(created).toBe(1);
    expect(memoryEmail.sent).toHaveLength(1);

    const email = memoryEmail.sent[0]!;
    // List-Unsubscribe header value forwarded to the provider…
    expect(email.listUnsubscribeUrl).toContain("/api/unsubscribe?token=");
    // …and the same personal link in the rendered footer.
    expect(email.text).toContain("Unsubscribe: https://my.goodstrata.test/api/unsubscribe?token=");
    const token = decodeURIComponent(email.listUnsubscribeUrl!.split("token=")[1]!);
    expect(unsubscribeService.verifyUnsubscribeToken(SECRET, token)).toEqual({
      userId: OWNER,
      notificationType: "levy.notice.issued",
    });
  });

  it("applyUnsubscribe flips email off for that type — bell keeps ringing, email stops", async () => {
    const token = unsubscribeService.createUnsubscribeToken(SECRET, OWNER, "levy.notice.issued");
    const applied = await unsubscribeService.applyUnsubscribe(ctxAs(), SECRET, token);
    expect(applied).toMatchObject({
      userId: OWNER,
      notificationType: "levy.notice.issued",
      label: "Levy notices",
    });

    memoryEmail.sent.length = 0;
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      levyEvent(),
    );
    expect(created).toBe(1); // in-app row still lands
    expect(memoryEmail.sent).toHaveLength(0); // email is off for this type

    // Idempotent: applying the same token again is a no-op, not an error.
    expect(await unsubscribeService.applyUnsubscribe(ctxAs(), SECRET, token)).not.toBeNull();

    // A bad token flips nothing.
    expect(await unsubscribeService.applyUnsubscribe(ctxAs(), SECRET, "garbage")).toBeNull();
  });
});
