import { invites, memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import {
  integrationsFromEnv,
  mockPaymentsProvider,
  type OutboundEmail,
} from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as invitesService from "../src/services/invites.js";
import * as peopleService from "../src/services/people.js";

/**
 * Auth & account access — invite/join permutations at the service layer.
 * Covers the /join page's backend contract: preview (public, token is the
 * credential), accept (signed-in only, single-use), and the invite issuing
 * guardrails (no manager_admin escalation, no email → no invite).
 */

let tdb: TestDatabase;
let schemeId: string;

const APP_URL = "http://localhost:3000";
const NOW = "2026-07-01T00:00:00Z";
const OFFICER = userActor("user-officer");

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};
const outbox = () => (integrations.email as unknown as { sent: OutboundEmail[] }).sent;

function ctxAt(iso: string, actor: Actor = OFFICER): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}

/**
 * A person on the roll with an email but NO login yet — inviting an email that
 * already has a login now auto-links instead of issuing a token, so the /join
 * (invite → signup → accept) contract is only exercised for new emails. Tests
 * that accept an invite call signUp() first to mirror real signup-then-accept.
 */
async function makeInvitee(slug: string) {
  const person = await peopleService.createPerson(ctxAt(NOW), schemeId, {
    givenName: slug,
    email: `${slug}@example.com`,
  });
  return { person, userId: `user-${slug}` };
}

/** Simulate the invitee completing signup: their login identity now exists. */
async function signUp(slug: string) {
  await tdb.db
    .insert(users)
    .values({ id: `user-${slug}`, name: slug, email: `${slug}@example.com` });
}

/** Invite and assert a real token was issued (i.e. the email wasn't auto-linked). */
async function issueInvite(
  personId: string,
  role: Parameters<typeof invitesService.invitePerson>[3] = "owner",
  at: string = NOW,
) {
  const r = await invitesService.invitePerson(ctxAt(at), schemeId, personId, role, APP_URL);
  if (r.linked) throw new Error("expected an invite token, but the email was auto-linked");
  return r;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Join Test OC",
      planOfSubdivision: "PS888888J",
      addressLine1: "8 Invite Way",
      suburb: "Northcote",
      postcode: "3070",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  // The officer issuing invites needs a login row for FK-free actor checks only;
  // memberships FK users, so give accepting users real rows (makeInvitee).
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("invitePerson guardrails", () => {
  it("refuses to grant manager_admin via invite (privilege escalation chokepoint)", async () => {
    const { person } = await makeInvitee("mallory");
    await expect(
      invitesService.invitePerson(ctxAt(NOW), schemeId, person.id, "manager_admin", APP_URL),
    ).rejects.toMatchObject({ code: "INVALID_ROLE", status: 422 });
    // Nothing persisted: the invite table has no row for this person.
    const rows = await tdb.db.query.invites.findMany({
      where: eq(invites.personId, person.id),
    });
    expect(rows).toHaveLength(0);
  });

  it("rejects a person with no email address", async () => {
    const person = await peopleService.createPerson(ctxAt(NOW), schemeId, {
      givenName: "Phoneless Pat",
      phone: "0400 000 001",
    });
    await expect(
      invitesService.invitePerson(ctxAt(NOW), schemeId, person.id, "owner", APP_URL),
    ).rejects.toMatchObject({ code: "NO_EMAIL", status: 422 });
  });

  it("404s an unknown person (and a person from another scheme's id space)", async () => {
    await expect(
      invitesService.invitePerson(
        ctxAt(NOW),
        schemeId,
        "00000000-0000-0000-0000-000000000000",
        "owner",
        APP_URL,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("issues a 14-day token and emails a /join link to the person's address", async () => {
    const { person } = await makeInvitee("alex");
    const before = outbox().length;
    const { token, expiresAt } = await issueInvite(person.id);
    expect(token.length).toBeGreaterThanOrEqual(24);
    expect(expiresAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");

    const sent = outbox().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("alex@example.com");
    expect(sent[0]!.subject).toContain("Join Test OC");
    expect(sent[0]!.text).toContain(`${APP_URL}/join?token=${token}`);
  });
});

describe("previewInvite (public — powers the signed-out /join page)", () => {
  it("returns scheme name, role, and invite email for a live token", async () => {
    const { person } = await makeInvitee("billie");
    const { token } = await issueInvite(person.id, "committee_member");
    const preview = await invitesService.previewInvite(ctxAt(NOW), token);
    expect(preview).toEqual({
      schemeName: "Join Test OC",
      role: "committee_member",
      email: "billie@example.com",
      name: "billie",
    });
  });

  it.each([
    ["empty token", ""],
    ["garbage token", "not-a-real-token"],
  ])("410s a %s", async (_label, token) => {
    await expect(invitesService.previewInvite(ctxAt(NOW), token)).rejects.toMatchObject({
      code: "INVALID_INVITE",
      status: 410,
    });
  });

  it("410s an expired token (14-day TTL lapsed)", async () => {
    const { person } = await makeInvitee("dana");
    const { token } = await issueInvite(person.id);
    // Still previews on the last day…
    await expect(
      invitesService.previewInvite(ctxAt("2026-07-14T23:59:59Z"), token),
    ).resolves.toMatchObject({ email: "dana@example.com" });
    // …but not once the expiry has passed.
    await expect(
      invitesService.previewInvite(ctxAt("2026-07-16T00:00:00Z"), token),
    ).rejects.toMatchObject({ code: "INVALID_INVITE", status: 410 });
  });
});

describe("acceptInvite", () => {
  it("403s a non-user actor — signing in is a precondition", async () => {
    const { person } = await makeInvitee("erin");
    const { token } = await issueInvite(person.id);
    await expect(
      invitesService.acceptInvite(ctxAt(NOW, systemActor("not-a-login")), token),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    // The failed attempt consumed nothing: the token still previews.
    await expect(invitesService.previewInvite(ctxAt(NOW), token)).resolves.toBeTruthy();
  });

  it("links login ↔ person, creates the membership, and is single-use", async () => {
    const { person, userId } = await makeInvitee("frankie");
    const { token } = await issueInvite(person.id);

    // The invitee signs up, then accepts.
    await signUp("frankie");
    const result = await invitesService.acceptInvite(ctxAt(NOW, userActor(userId)), token);
    expect(result).toEqual({ schemeId });

    // Person record now carries the login identity.
    const linked = await tdb.db.query.people.findFirst({ where: eq(people.id, person.id) });
    expect(linked?.userId).toBe(userId);

    // Membership created with the invited role, open-ended, dated from the clock.
    const rows = await tdb.db.query.memberships.findMany({
      where: and(eq(memberships.schemeId, schemeId), eq(memberships.userId, userId)),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "owner", startedOn: "2026-07-01", endedOn: null });

    // Single-use: the same token neither previews nor accepts again.
    await expect(invitesService.previewInvite(ctxAt(NOW), token)).rejects.toMatchObject({
      code: "INVALID_INVITE",
      status: 410,
    });
    await expect(
      invitesService.acceptInvite(ctxAt(NOW, userActor(userId)), token),
    ).rejects.toMatchObject({ code: "INVALID_INVITE", status: 410 });
  });

  it("does not duplicate an open membership when re-invited with the same role", async () => {
    const { person, userId } = await makeInvitee("gus");
    const first = await issueInvite(person.id);
    await signUp("gus");
    await invitesService.acceptInvite(ctxAt(NOW, userActor(userId)), first.token);

    // Re-invited later: the login now exists, so this auto-links rather than
    // issuing a new token — and must not open a second membership.
    const second = await invitesService.invitePerson(
      ctxAt("2026-07-02T00:00:00Z"),
      schemeId,
      person.id,
      "owner",
      APP_URL,
    );
    expect(second.linked).toBe(true);

    const rows = await tdb.db.query.memberships.findMany({
      where: and(
        eq(memberships.schemeId, schemeId),
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
      ),
    });
    expect(rows).toHaveLength(1);
  });

  it("410s an expired token even for a signed-in user", async () => {
    const { person, userId } = await makeInvitee("harper");
    const { token } = await issueInvite(person.id);
    await expect(
      invitesService.acceptInvite(ctxAt("2026-07-16T00:00:00Z", userActor(userId)), token),
    ).rejects.toMatchObject({ code: "INVALID_INVITE", status: 410 });
    // No membership was written by the failed accept.
    const rows = await tdb.db.query.memberships.findMany({
      where: and(eq(memberships.schemeId, schemeId), eq(memberships.userId, userId)),
    });
    expect(rows).toHaveLength(0);
  });
});
