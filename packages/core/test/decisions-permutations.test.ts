import { memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import {
  type Actor,
  type DeciderRole,
  fixedClock,
  systemActor,
  userActor,
} from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";

/**
 * Permutation coverage for the decisions & committee-voting family:
 * roles × decider tier (server-side authority, mirroring the web's canDecide),
 * note handling, custom option labels, and resolution edge cases the
 * DecisionsTab UI leans on (poll races, double resolve, tally maths).
 *
 * Complements decision-votes.test.ts (majority forming, executor, listing).
 */

let tdb: TestDatabase;
let schemeId: string;
/** Second scheme with exactly 4 plain owners — even-eligible boundary maths. */
let evenSchemeId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};

const NOW = "2026-07-02T00:00:00Z";
function ctxAs(actor: Actor): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

const MANAGER = "perm-manager";
const CHAIR = "perm-chair";
const SECRETARY = "perm-secretary";
const TREASURER = "perm-treasurer";
const COMMITTEE = "perm-committee";
const OWNER1 = "perm-owner-1";
const OWNER2 = "perm-owner-2";
const FORMER = "perm-former-owner";

const EVEN_OWNERS = ["perm-even-1", "perm-even-2", "perm-even-3", "perm-even-4"];

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const rows = await tdb.db
    .insert(schemes)
    .values([
      {
        name: "Permutation Test OC",
        planOfSubdivision: "PS777777P",
        addressLine1: "7 Matrix Pl",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 4,
        status: "active",
      },
      {
        name: "Even Split OC",
        planOfSubdivision: "PS444444E",
        addressLine1: "4 Tie Ct",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 4,
        status: "active",
      },
    ])
    .returning();
  schemeId = rows[0]!.id;
  evenSchemeId = rows[1]!.id;

  await tdb.db.insert(users).values([
    { id: MANAGER, name: "Marta Manager", email: "perm-manager@example.com" },
    { id: CHAIR, name: "Casey Chair", email: "perm-chair@example.com" },
    { id: SECRETARY, name: "Sasha Secretary", email: "perm-secretary@example.com" },
    { id: TREASURER, name: "Terry Treasurer", email: "perm-treasurer@example.com" },
    { id: COMMITTEE, name: "Codey Committee", email: "perm-committee@example.com" },
    { id: OWNER1, name: "Olly Owner", email: "perm-owner-1@example.com" },
    { id: OWNER2, name: "Ozzy Owner", email: "perm-owner-2@example.com" },
    { id: FORMER, name: "Fern Former", email: "perm-former@example.com" },
    ...EVEN_OWNERS.map((id, i) => ({
      id,
      name: `Even Owner ${i + 1}`,
      email: `${id}@example.com`,
    })),
  ]);

  await tdb.db.insert(memberships).values([
    { schemeId, userId: MANAGER, role: "manager_admin", startedOn: "2025-01-01" },
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    // The chair also owns a lot: distinct-user counting must not double-count.
    { schemeId, userId: CHAIR, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: SECRETARY, role: "secretary", startedOn: "2025-01-01" },
    { schemeId, userId: TREASURER, role: "treasurer", startedOn: "2025-01-01" },
    { schemeId, userId: COMMITTEE, role: "committee_member", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER1, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER2, role: "owner", startedOn: "2025-01-01" },
    // Sold up last year — must not count toward any eligible-voter tally.
    { schemeId, userId: FORMER, role: "owner", startedOn: "2025-01-01", endedOn: "2025-12-31" },
    ...EVEN_OWNERS.map((userId) => ({
      schemeId: evenSchemeId,
      userId,
      role: "owner" as const,
      startedOn: "2025-01-01",
    })),
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

async function openDecision(deciderRole: DeciderRole, overrides: Record<string, unknown> = {}) {
  return await decisionsService.requestDecision(ctxAs(userActor(MANAGER)), {
    schemeId,
    kind: "other",
    title: `Permutation: ${deciderRole}`,
    summaryMd: "Matrix coverage decision.",
    deciderRole,
    ...overrides,
  });
}

describe("rolesAllowedToDecide (the matrix the web's canDecide mirrors)", () => {
  it("treasurer tier admits only the treasurer and manager_admin", () => {
    expect(decisionsService.rolesAllowedToDecide("treasurer")).toEqual([
      "treasurer",
      "manager_admin",
    ]);
  });

  it("committee tier admits committee_member (not officer-gated) plus officers and manager_admin", () => {
    const allowed = decisionsService.rolesAllowedToDecide("committee");
    expect(allowed).toContain("committee_member");
    expect(allowed).toContain("chair");
    expect(allowed).toContain("secretary");
    expect(allowed).toContain("treasurer");
    expect(allowed).toContain("manager_admin");
    expect(allowed).not.toContain("owner");
  });

  it("all_owners tier admits plain owners too", () => {
    const allowed = decisionsService.rolesAllowedToDecide("all_owners");
    expect(allowed).toContain("owner");
    expect(allowed).toContain("committee_member");
    expect(allowed).toContain("manager_admin");
  });
});

describe("roles × decider-tier authority (server side of canDecide)", () => {
  it("treasurer tier: chair, committee_member and plain owner are all rejected with 403", async () => {
    const decision = await openDecision("treasurer");

    for (const [userId, roles] of [
      [CHAIR, ["chair", "owner"]],
      [COMMITTEE, ["committee_member"]],
      [OWNER1, ["owner"]],
    ] as const) {
      await expect(
        decisionsService.resolveDecision(
          ctxAs(userActor(userId)),
          schemeId,
          decision.id,
          "approve",
          [...roles],
        ),
      ).rejects.toMatchObject({
        name: "DomainError",
        code: "FORBIDDEN",
        status: 403,
        message: "This decision is for the treasurer",
      });
    }

    // Nobody ineligible left a mark: the decision is still pending.
    const listed = await decisionsService.listDecisions(ctxAs(userActor(OWNER1)), schemeId);
    expect(listed.find((d) => d.id === decision.id)?.status).toBe("pending");
  });

  it("treasurer tier: manager_admin can decide everything (single vote resolves instantly)", async () => {
    const decision = await openDecision("treasurer");
    const result = await decisionsService.resolveDecision(
      ctxAs(userActor(MANAGER)),
      schemeId,
      decision.id,
      "approve",
      ["manager_admin"],
    );
    expect(result).toMatchObject({ decisionId: decision.id, status: "approved" });

    const listed = await decisionsService.listDecisions(ctxAs(userActor(OWNER1)), schemeId);
    expect(listed.find((d) => d.id === decision.id)).toMatchObject({
      status: "approved",
      decidedByUserId: MANAGER,
      decidedByName: "Marta Manager",
    });
  });

  it("committee tier: committee_member CAN vote (contrast with officer-gated families)", async () => {
    const decision = await openDecision("committee");
    const result = await decisionsService.castDecisionVote(
      ctxAs(userActor(COMMITTEE)),
      schemeId,
      decision.id,
      COMMITTEE,
      "approve",
      ["committee_member"],
    );
    // 5 eligible: chair, secretary, treasurer, committee_member, manager_admin
    // (chair's second owner membership and the ended owner don't inflate it).
    expect(result).toMatchObject({ status: "pending", votesFor: 1, votesAgainst: 0, eligible: 5 });
  });

  it("committee tier: plain owner is rejected but manager_admin may vote", async () => {
    const decision = await openDecision("committee");
    await expect(
      decisionsService.castDecisionVote(
        ctxAs(userActor(OWNER2)),
        schemeId,
        decision.id,
        OWNER2,
        "approve",
        ["owner"],
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const result = await decisionsService.castDecisionVote(
      ctxAs(userActor(MANAGER)),
      schemeId,
      decision.id,
      MANAGER,
      "approve",
      ["manager_admin"],
    );
    expect(result).toMatchObject({ status: "pending", votesFor: 1, eligible: 5 });
  });

  it("all_owners tier: everyone votes; majority is floor(eligible/2)+1 of 7", async () => {
    const decision = await openDecision("all_owners");

    // 7 eligible (FORMER ended, CHAIR counted once) → 4 approvals carry.
    const voters: [string, ("owner" | "committee_member")[]][] = [
      [OWNER1, ["owner"]],
      [OWNER2, ["owner"]],
      [COMMITTEE, ["committee_member"]],
    ];
    for (const [userId, roles] of voters) {
      const r = await decisionsService.castDecisionVote(
        ctxAs(userActor(userId)),
        schemeId,
        decision.id,
        userId,
        "approve",
        roles,
      );
      expect(r.status).toBe("pending");
      expect(r.eligible).toBe(7);
    }

    const fourth = await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "approve",
      ["chair", "owner"],
    );
    expect(fourth).toMatchObject({ status: "approved", votesFor: 4, votesAgainst: 0, eligible: 7 });
  });

  it("treasurer tier reports 2 eligible (treasurer + manager_admin)", async () => {
    const decision = await openDecision("treasurer");
    const result = await decisionsService.castDecisionVote(
      ctxAs(userActor(TREASURER)),
      schemeId,
      decision.id,
      TREASURER,
      "decline",
      ["treasurer"],
    );
    expect(result).toMatchObject({ status: "declined", eligible: 2 });
  });
});

describe("inputs: notes and option labels", () => {
  it("persists a vote note and returns it in the tally listing", async () => {
    const decision = await openDecision("committee");
    await decisionsService.castDecisionVote(
      ctxAs(userActor(SECRETARY)),
      schemeId,
      decision.id,
      SECRETARY,
      "decline",
      ["secretary"],
      "Quotes look thin — get a second one.",
    );

    const tally = await decisionsService.listDecisionVotes(
      ctxAs(userActor(OWNER1)),
      schemeId,
      decision.id,
    );
    expect(tally.votes).toHaveLength(1);
    expect(tally.votes[0]).toMatchObject({
      userId: SECRETARY,
      name: "Sasha Secretary",
      choice: "decline",
      note: "Quotes look thin — get a second one.",
    });
    expect(tally).toMatchObject({ votesFor: 0, votesAgainst: 1, eligible: 5 });
  });

  it("stores a note at the UI's 2000-char maxLength boundary intact", async () => {
    const decision = await openDecision("committee");
    const note = "n".repeat(2000);
    await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "approve",
      ["chair"],
      note,
    );

    const tally = await decisionsService.listDecisionVotes(
      ctxAs(userActor(OWNER1)),
      schemeId,
      decision.id,
    );
    expect(tally.votes[0]?.note).toHaveLength(2000);
    expect(tally.votes[0]?.note).toBe(note);
  });

  it("resolve choosing the decline option records status, optionId and note", async () => {
    const decision = await openDecision("treasurer");
    const result = await decisionsService.resolveDecision(
      ctxAs(userActor(TREASURER)),
      schemeId,
      decision.id,
      "decline",
      ["treasurer"],
      "Not in this year's budget.",
    );
    expect(result).toMatchObject({ status: "declined", optionId: "decline" });

    const listed = await decisionsService.listDecisions(ctxAs(userActor(OWNER1)), schemeId);
    expect(listed.find((d) => d.id === decision.id)).toMatchObject({
      status: "declined",
      resolution: { optionId: "decline" },
      decisionNote: "Not in this year's budget.",
      decidedByUserId: TREASURER,
      decidedByName: "Terry Treasurer",
    });
  });

  it("custom option labels ride on the approve/decline ids end to end", async () => {
    const decision = await openDecision("committee", {
      options: [
        { id: "approve", label: "Acknowledge" },
        { id: "decline", label: "Flag for discussion" },
      ],
    });

    // The listing carries the custom labels the UI maps onto the vote buttons.
    const listed = await decisionsService.listDecisions(ctxAs(userActor(OWNER1)), schemeId);
    const found = listed.find((d) => d.id === decision.id);
    expect(found?.options).toEqual([
      { id: "approve", label: "Acknowledge" },
      { id: "decline", label: "Flag for discussion" },
    ]);

    // Votes still use the canonical approve/decline ids underneath.
    const result = await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "decline",
      ["chair"],
    );
    expect(result).toMatchObject({ status: "pending", votesAgainst: 1 });
  });

  it("rejects a resolve with an option id outside approve/decline", async () => {
    const decision = await openDecision("treasurer");
    await expect(
      decisionsService.resolveDecision(
        ctxAs(userActor(TREASURER)),
        schemeId,
        decision.id,
        "acknowledge",
        ["treasurer"],
      ),
    ).rejects.toMatchObject({ code: "INVALID_OPTION", status: 422 });
  });

  it("only a user actor may resolve — system/agent actors are refused", async () => {
    const decision = await openDecision("treasurer");
    await expect(
      decisionsService.resolveDecision(
        ctxAs(systemActor("decision-executor")),
        schemeId,
        decision.id,
        "approve",
        ["manager_admin"],
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("server outcomes the UI leans on", () => {
  it("resolving an already-resolved decision (5s poll raced) surfaces ALREADY_RESOLVED 409", async () => {
    const decision = await openDecision("treasurer");
    await decisionsService.resolveDecision(
      ctxAs(userActor(TREASURER)),
      schemeId,
      decision.id,
      "approve",
      ["treasurer"],
    );

    // The manager's stale tab clicks Approve after the treasurer already did.
    await expect(
      decisionsService.resolveDecision(
        ctxAs(userActor(MANAGER)),
        schemeId,
        decision.id,
        "approve",
        ["manager_admin"],
      ),
    ).rejects.toMatchObject({
      code: "ALREADY_RESOLVED",
      status: 409,
      message: "This decision has already been resolved",
    });
  });

  it("double vote from the same user is a 409 the panel can render inline", async () => {
    const decision = await openDecision("committee");
    await decisionsService.castDecisionVote(
      ctxAs(userActor(SECRETARY)),
      schemeId,
      decision.id,
      SECRETARY,
      "approve",
      ["secretary"],
    );
    await expect(
      decisionsService.castDecisionVote(
        ctxAs(userActor(SECRETARY)),
        schemeId,
        decision.id,
        SECRETARY,
        "approve",
        ["secretary"],
      ),
    ).rejects.toMatchObject({ code: "ALREADY_VOTED", status: 409 });
  });

  it("even eligible count: a 2–2 split declines once approvals can't reach 3 of 4", async () => {
    const decision = await decisionsService.requestDecision(ctxAs(userActor(EVEN_OWNERS[0]!)), {
      schemeId: evenSchemeId,
      kind: "other",
      title: "Even split boundary",
      summaryMd: "4 eligible — needs 3 approvals.",
      deciderRole: "all_owners",
    });

    const cast = (userId: string, choice: "approve" | "decline") =>
      decisionsService.castDecisionVote(
        ctxAs(userActor(userId)),
        evenSchemeId,
        decision.id,
        userId,
        choice,
        ["owner"],
      );

    expect((await cast(EVEN_OWNERS[0]!, "approve")).status).toBe("pending");
    // 2 of 4 approvals is NOT a majority (needs floor(4/2)+1 = 3).
    expect(await cast(EVEN_OWNERS[1]!, "approve")).toMatchObject({
      status: "pending",
      votesFor: 2,
      eligible: 4,
    });
    // 1 decline: approvals (2) could still reach 3 — stays pending.
    expect((await cast(EVEN_OWNERS[2]!, "decline")).status).toBe("pending");
    // 2nd decline: approvals are locked out at 2 — declined on the tie.
    expect(await cast(EVEN_OWNERS[3]!, "decline")).toMatchObject({
      status: "declined",
      votesFor: 2,
      votesAgainst: 2,
      eligible: 4,
    });
  });

  it("decisions are scoped to their scheme: cross-scheme access reads as not found", async () => {
    const decision = await openDecision("all_owners");
    await expect(
      decisionsService.castDecisionVote(
        ctxAs(userActor(EVEN_OWNERS[0]!)),
        evenSchemeId, // wrong scheme for this decision id
        decision.id,
        EVEN_OWNERS[0]!,
        "approve",
        ["owner"],
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    await expect(
      decisionsService.listDecisionVotes(
        ctxAs(userActor(OWNER1)),
        schemeId,
        // valid uuid, no such row
        "00000000-0000-4000-8000-000000000000",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
