import { memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";

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

const NOW = "2026-07-02T00:00:00Z";
function ctxAs(actor: Actor): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

const CHAIR = "user-chair";
const SECRETARY = "user-secretary";
const TREASURER = "user-treasurer";
const OWNER = "user-owner";

// The follow-up executor action used to prove the executor fires on majority.
const executed: string[] = [];
decisionsService.registerDecisionAction("test.mark", async (_ctx, args) => {
  executed.push(String(args.tag));
});

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Voting Test OC",
      planOfSubdivision: "PS888888V",
      addressLine1: "8 Ballot St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair@example.com" },
    { id: SECRETARY, name: "Sasha Secretary", email: "secretary@example.com" },
    { id: TREASURER, name: "Terry Treasurer", email: "treasurer@example.com" },
    { id: OWNER, name: "Olly Owner", email: "owner@example.com" },
  ]);
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: SECRETARY, role: "secretary", startedOn: "2025-01-01" },
    { schemeId, userId: TREASURER, role: "treasurer", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2025-01-01" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

async function openCommitteeDecision(tag: string) {
  return await decisionsService.requestDecision(ctxAs(userActor(CHAIR)), {
    schemeId,
    kind: "other",
    title: `Committee call: ${tag}`,
    summaryMd: "Needs a committee majority.",
    deciderRole: "committee",
    followUp: { type: "action", action: "test.mark", args: { tag } },
  });
}

describe("committee voting on decisions", () => {
  it("stays pending until a majority forms, then resolves and the executor fires", async () => {
    const decision = await openCommitteeDecision("majority");

    // 3 eligible committee voters (chair, secretary, treasurer); 1 approve < majority.
    const first = await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "approve",
      ["chair"],
    );
    expect(first).toMatchObject({ status: "pending", votesFor: 1, votesAgainst: 0, eligible: 3 });

    // Second approve: 2 > 3/2 — resolved approved.
    const second = await decisionsService.castDecisionVote(
      ctxAs(userActor(SECRETARY)),
      schemeId,
      decision.id,
      SECRETARY,
      "approve",
      ["secretary"],
    );
    expect(second).toMatchObject({ status: "approved", votesFor: 2, votesAgainst: 0, eligible: 3 });

    // decision.resolved landed in the log alongside the vote events.
    const resolvedEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.type, "decision.resolved"), eq(t.stream, `decision:${decision.id}`)),
    });
    expect(resolvedEvents).toHaveLength(1);
    const voteEvents = await tdb.db.query.eventLog.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.type, "decision.vote.cast"), eq(t.stream, `decision:${decision.id}`)),
    });
    expect(voteEvents).toHaveLength(2);

    // The follow-up executor (same code path the worker runs) fires the action.
    executed.length = 0;
    const { executed: action } = await decisionsService.executeDecisionFollowUp(
      ctxAs(systemActor("decision-executor")),
      decision.id,
    );
    expect(action).toBe("test.mark");
    expect(executed).toEqual(["majority"]);

    // Late votes on a resolved decision are rejected.
    await expect(
      decisionsService.castDecisionVote(
        ctxAs(userActor(TREASURER)),
        schemeId,
        decision.id,
        TREASURER,
        "approve",
        ["treasurer"],
      ),
    ).rejects.toThrow(/already been resolved/);
  });

  it("rejects a double vote from the same user", async () => {
    const decision = await openCommitteeDecision("double-vote");
    await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "approve",
      ["chair"],
    );
    await expect(
      decisionsService.castDecisionVote(
        ctxAs(userActor(CHAIR)),
        schemeId,
        decision.id,
        CHAIR,
        "decline",
        ["chair"],
      ),
    ).rejects.toThrow(/already voted/i);
  });

  it("rejects votes from roles outside the decider tier", async () => {
    const decision = await openCommitteeDecision("ineligible");
    await expect(
      decisionsService.castDecisionVote(
        ctxAs(userActor(OWNER)),
        schemeId,
        decision.id,
        OWNER,
        "approve",
        ["owner"],
      ),
    ).rejects.toThrow(/committee/);
  });

  it("declines once approvals can no longer reach a majority", async () => {
    const decision = await openCommitteeDecision("declined");

    // 1 decline of 3 eligible: approvals could still win — pending.
    const first = await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "decline",
      ["chair"],
    );
    expect(first.status).toBe("pending");

    // 2 declines >= 3/2: majority is out of reach — declined.
    const second = await decisionsService.castDecisionVote(
      ctxAs(userActor(TREASURER)),
      schemeId,
      decision.id,
      TREASURER,
      "decline",
      ["treasurer"],
    );
    expect(second).toMatchObject({ status: "declined", votesFor: 0, votesAgainst: 2 });

    // Declined follow-ups never execute.
    executed.length = 0;
    const result = await decisionsService.executeDecisionFollowUp(
      ctxAs(systemActor("decision-executor")),
      decision.id,
    );
    expect(result.executed).toBeNull();
    expect(executed).toEqual([]);
  });

  it("treasurer-tier decisions resolve on a single eligible vote (as before)", async () => {
    const decision = await decisionsService.requestDecision(ctxAs(userActor(CHAIR)), {
      schemeId,
      kind: "budget_adoption",
      title: "Adopt the budget",
      summaryMd: "Treasurer sign-off.",
      deciderRole: "treasurer",
    });

    const result = await decisionsService.resolveDecision(
      ctxAs(userActor(TREASURER)),
      schemeId,
      decision.id,
      "approve",
      ["treasurer"],
    );
    expect(result.status).toBe("approved");
  });

  it("lists decisions with the decider's name once resolved", async () => {
    const decision = await decisionsService.requestDecision(ctxAs(userActor(CHAIR)), {
      schemeId,
      kind: "budget_adoption",
      title: "Adopt the audit-trail budget",
      summaryMd: "Treasurer sign-off.",
      deciderRole: "treasurer",
    });
    await decisionsService.resolveDecision(
      ctxAs(userActor(TREASURER)),
      schemeId,
      decision.id,
      "approve",
      ["treasurer"],
      "Within the adopted plan",
    );

    const listed = await decisionsService.listDecisions(ctxAs(userActor(OWNER)), schemeId);
    const resolved = listed.find((d) => d.id === decision.id);
    expect(resolved).toMatchObject({
      status: "approved",
      decidedByUserId: TREASURER,
      decidedByName: "Terry Treasurer",
      decisionNote: "Within the adopted plan",
    });
    expect(resolved?.resolvedAt).not.toBeNull();

    // Unresolved decisions carry a null decider name (left join, not inner).
    const open = await openCommitteeDecision("audit-list");
    const pending = (await decisionsService.listDecisions(ctxAs(userActor(OWNER)), schemeId)).find(
      (d) => d.id === open.id,
    );
    expect(pending).toMatchObject({ status: "pending", decidedByName: null });
  });

  it("lists votes with voter names, tally and eligible count", async () => {
    const decision = await openCommitteeDecision("listing");
    await decisionsService.castDecisionVote(
      ctxAs(userActor(CHAIR)),
      schemeId,
      decision.id,
      CHAIR,
      "approve",
      ["chair"],
      "Looks right to me",
    );
    await decisionsService.castDecisionVote(
      ctxAs(userActor(SECRETARY)),
      schemeId,
      decision.id,
      SECRETARY,
      "decline",
      ["secretary"],
    );

    const listing = await decisionsService.listDecisionVotes(
      ctxAs(userActor(OWNER)),
      schemeId,
      decision.id,
    );
    expect(listing.eligible).toBe(3);
    expect(listing.votesFor).toBe(1);
    expect(listing.votesAgainst).toBe(1);
    expect(listing.votes).toHaveLength(2);
    expect(listing.votes[0]).toMatchObject({
      userId: CHAIR,
      name: "Casey Chair",
      choice: "approve",
      note: "Looks right to me",
    });
    expect(listing.votes[1]).toMatchObject({
      userId: SECRETARY,
      name: "Sasha Secretary",
      choice: "decline",
    });
  });
});
