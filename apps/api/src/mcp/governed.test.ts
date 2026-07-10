/**
 * Governed MCP tools — the mcp:govern scope fence and the two-phase
 * preview→confirm contract, driven end-to-end through a real McpServer +
 * MCP client over an in-memory transport (so scope gates, zod schemas, and
 * the guard/error surface are all exercised exactly as a remote client would).
 *
 * Covers: scope enforcement (an mcp:write token cannot reach governed tools),
 * role/membership tier (404 for outsiders, FORBIDDEN below officer tier),
 * dry-run accuracy (no mutation + engine-exact amounts), token integrity
 * (tampered / expired / args-changed / wrong-user), and confirm executing
 * exactly once (replays surface the domain idempotency conflict).
 */
import {
  budgetLines,
  budgets,
  decisions,
  levyNotices,
  levySchedules,
  lotLedgerEntries,
  lots,
  meetings,
  memberships,
  motions,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { fixedClock } from "@goodstrata/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { Env } from "../env.js";
import type { McpScope } from "./auth.js";
import { buildMcpServer } from "./server.js";

const NOW = "2026-07-11T00:00:00Z";
const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
  PAYMENTS_PROVIDER: "mock",
});
const env = {
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef",
  MCP_CONFIRM_SECRET: "confirm-secret-0123456789abcdef",
} as unknown as Env;

let tdb: TestDatabase;
let deps: AppDeps;
/** Same db + secret, clock 11 minutes later — past the 10-minute token TTL. */
let lateDeps: AppDeps;
let schemeId: string;
let scheduleId: string;
let agmId: string;
let lateMeetingId: string;
let closableMeetingId: string;
let treasurerDecisionId: string;
let committeeDecisionId: string;

const USERS = {
  treasurer: "u-treasurer",
  chair: "u-chair",
  owner: "u-owner",
  manager: "u-manager",
} as const;

function makeDeps(at: string): AppDeps {
  const clock = fixedClock(at);
  return {
    env,
    db: tdb.db,
    integrations,
    clock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, clock),
  } as unknown as AppDeps;
}

/** Call one tool through a real MCP client/server pair for the given identity. */
async function callTool(
  userId: string,
  scopes: McpScope[],
  name: string,
  args: Record<string, unknown>,
  useDeps: AppDeps = deps,
): Promise<CallToolResult> {
  const server = buildMcpServer(useDeps, { userId, clientId: "test-client", scopes });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "governed-test", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  } finally {
    await client.close();
    await server.close();
  }
}

function textOf(res: CallToolResult): string {
  const first = res.content[0];
  return first?.type === "text" ? first.text : "";
}

/** The structured JSON payload (second content block) of a successful result. */
function payloadOf<T = Record<string, unknown>>(res: CallToolResult): T {
  expect(res.isError ?? false).toBe(false);
  const second = res.content[1];
  if (second?.type !== "text") throw new Error("expected a JSON payload block");
  return JSON.parse(second.text) as T;
}

function expectToolError(res: CallToolResult, code: string): void {
  expect(res.isError).toBe(true);
  expect(textOf(res)).toContain(`${code}:`);
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  deps = makeDeps(NOW);
  lateDeps = makeDeps("2026-07-11T00:11:00Z");

  await tdb.db
    .insert(users)
    .values(Object.values(USERS).map((id) => ({ id, name: id, email: `${id}@example.com` })));

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Govern Test OC",
      planOfSubdivision: "PS700001G",
      addressLine1: "1 Governance Way",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(memberships).values(
    (
      [
        ["treasurer", USERS.treasurer],
        ["chair", USERS.chair],
        ["owner", USERS.owner],
        ["manager_admin", USERS.manager],
      ] as const
    ).map(([role, userId]) => ({ schemeId, userId, role, startedOn: "2026-01-01" })),
  );

  // Three lots, liabilities 50/30/20 → clean largest-remainder splits.
  const lotRows = await tdb.db
    .insert(lots)
    .values(
      [
        ["1", 50],
        ["2", 30],
        ["3", 20],
      ].map(([lotNumber, weight]) => ({
        schemeId,
        lotNumber: String(lotNumber),
        entitlement: Number(weight),
        liability: Number(weight),
      })),
    )
    .returning();

  // Owners on the roll: lots 1 and 2 reachable by email, lot 3 has none.
  const personRows = await tdb.db
    .insert(people)
    .values([
      { schemeId, givenName: "Ada", familyName: "Owner", email: "ada@example.com" },
      { schemeId, givenName: "Ben", familyName: "Owner", email: "ben@example.com" },
      { schemeId, givenName: "Cam", familyName: "NoEmail", email: null },
    ])
    .returning();
  await tdb.db.insert(ownerships).values(
    personRows.map((p, i) => ({
      schemeId,
      lotId: lotRows[i]!.id,
      personId: p.id,
      startedOn: "2026-01-01",
    })),
  );

  // Adopted budget: admin 40_000c + maintenance 20_000c = 60_000c/yr →
  // 15_000c per quarterly instalment, split 7_500/4_500/3_000 across the lots.
  const budgetRows = await tdb.db
    .insert(budgets)
    .values({ schemeId, fiscalYearStart: "2026-07-01", status: "adopted" })
    .returning();
  await tdb.db.insert(budgetLines).values([
    { budgetId: budgetRows[0]!.id, fundKind: "admin", category: "general", amountCents: 40_000 },
    {
      budgetId: budgetRows[0]!.id,
      fundKind: "maintenance",
      category: "general",
      amountCents: 20_000,
    },
  ]);
  const scheduleRows = await tdb.db
    .insert(levySchedules)
    .values({
      schemeId,
      budgetId: budgetRows[0]!.id,
      frequency: "quarterly",
      instalments: 4,
      firstDueOn: "2026-08-01",
    })
    .returning();
  scheduleId = scheduleRows[0]!.id;

  // Meetings: an AGM 35 days out (draft), an SGM only 5 days out (draft —
  // fails the ss 72(1)/76(1) 14-day check), and an in-progress AGM to close.
  const meetingRows = await tdb.db
    .insert(meetings)
    .values([
      { schemeId, kind: "agm", title: "2026 AGM", scheduledAt: new Date("2026-08-15T02:00:00Z") },
      { schemeId, kind: "sgm", title: "Rush SGM", scheduledAt: new Date("2026-07-16T02:00:00Z") },
      {
        schemeId,
        kind: "agm",
        title: "2025 AGM (wrapping up)",
        scheduledAt: new Date("2026-07-10T02:00:00Z"),
        status: "in_progress",
      },
    ])
    .returning();
  agmId = meetingRows[0]!.id;
  lateMeetingId = meetingRows[1]!.id;
  closableMeetingId = meetingRows[2]!.id;
  await tdb.db.insert(motions).values({
    schemeId,
    meetingId: closableMeetingId,
    title: "Repaint the lobby",
    text: "That the lobby be repainted.",
    resolutionType: "ordinary",
    status: "open",
    opensAt: new Date("2026-07-10T02:30:00Z"),
  });

  // Decision gates: a treasurer-tier one carrying a follow-up action, and a
  // committee-tier one that needs a majority (eligible: chair, treasurer,
  // manager_admin = 3).
  const decisionRows = await tdb.db
    .insert(decisions)
    .values([
      {
        schemeId,
        kind: "budget_adoption",
        title: "Adopt FY27 budget",
        summaryMd: "Adopt the proposed budget.",
        options: [
          { id: "approve", label: "Approve" },
          { id: "decline", label: "Decline" },
        ],
        deciderRole: "treasurer",
        followUp: { type: "action", action: "finance.adoptBudget", args: { budgetId: "b-1" } },
      },
      {
        schemeId,
        kind: "quote_approval",
        title: "Approve gardening quote",
        summaryMd: "Approve the quote.",
        options: [
          { id: "approve", label: "Approve" },
          { id: "decline", label: "Decline" },
        ],
        deciderRole: "committee",
      },
    ])
    .returning();
  treasurerDecisionId = decisionRows[0]!.id;
  committeeDecisionId = decisionRows[1]!.id;
});

afterAll(async () => {
  await tdb.cleanup();
});

// ---------------------------------------------------------------------------
// Scope fence: mcp:write is NOT enough for any governed tool.
// ---------------------------------------------------------------------------

describe("mcp:govern scope enforcement", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["issue_levy_run", { scheduleId: "x", instalment: 1 }],
    ["send_meeting_notice", { meetingId: "x" }],
    ["resolve_decision", { decisionId: "x", optionId: "approve" }],
    ["cast_motion_vote", { decisionId: "x", choice: "approve" }],
    ["close_meeting", { meetingId: "x" }],
  ];

  it.each(calls)("%s refuses a read+write token, naming the missing scope", async (name, args) => {
    const res = await callTool(USERS.treasurer, ["mcp:read", "mcp:write"], name, {
      schemeId,
      ...args,
    });
    expectToolError(res, "FORBIDDEN");
    expect(textOf(res)).toContain("'mcp:govern'");
  });

  it("the scope gate fires before the scheme lookup (bogus scheme, no scope → scope error)", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:write"], "issue_levy_run", {
      schemeId: "00000000-0000-0000-0000-000000000000",
      scheduleId: "x",
      instalment: 1,
    });
    expectToolError(res, "FORBIDDEN");
    expect(textOf(res)).toContain("'mcp:govern'");
  });
});

// ---------------------------------------------------------------------------
// Membership + role tier (matching the HTTP routes).
// ---------------------------------------------------------------------------

describe("membership and role tier", () => {
  it("404s a non-member holding mcp:govern (scheme existence never leaks)", async () => {
    const res = await callTool("u-outsider", ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
    });
    expectToolError(res, "NOT_FOUND");
  });

  it("refuses a plain owner below the officer tier for issue_levy_run", async () => {
    const res = await callTool(USERS.owner, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
    });
    expectToolError(res, "FORBIDDEN");
    expect(textOf(res)).toContain("chair, secretary, treasurer");
  });

  it("refuses an owner outside the decider tier for resolve_decision (service tier pre-checked in the dry-run)", async () => {
    const res = await callTool(USERS.owner, ["mcp:govern"], "resolve_decision", {
      schemeId,
      decisionId: treasurerDecisionId,
      optionId: "approve",
    });
    expectToolError(res, "FORBIDDEN");
    expect(textOf(res)).toContain("treasurer");
  });
});

// ---------------------------------------------------------------------------
// issue_levy_run — dry-run accuracy + token integrity + confirm-once.
// ---------------------------------------------------------------------------

describe("issue_levy_run", () => {
  let confirmToken: string;

  it("preview returns the engine-exact per-lot apportionment and mutates nothing", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
    });
    const body = payloadOf<{
      dryRun: boolean;
      confirmToken: string;
      preview: {
        dueOn: string;
        totalCents: number;
        perLot: { lotNumber: string; totalCents: number }[];
      };
    }>(res);
    expect(textOf(res)).toContain("DRY RUN");
    expect(body.dryRun).toBe(true);
    expect(body.confirmToken).toBeTruthy();
    expect(body.preview.dueOn).toBe("2026-08-01");
    expect(body.preview.totalCents).toBe(15_000);
    const byLot = Object.fromEntries(body.preview.perLot.map((l) => [l.lotNumber, l.totalCents]));
    expect(byLot).toEqual({ "1": 7_500, "2": 4_500, "3": 3_000 });
    confirmToken = body.confirmToken;

    // Genuine dry-run: nothing was written.
    const notices = await tdb.db.query.levyNotices.findMany({
      where: eq(levyNotices.schemeId, schemeId),
    });
    expect(notices).toHaveLength(0);
  });

  it("rejects a tampered token (CONFIRM_INVALID)", async () => {
    const tampered = confirmToken.slice(0, -2) + (confirmToken.endsWith("AA") ? "BB" : "AA");
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
      confirmToken: tampered,
    });
    expectToolError(res, "CONFIRM_INVALID");
  });

  it("rejects the token when the arguments changed (CONFIRM_MISMATCH)", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 2, // token was minted for instalment 1
      confirmToken,
    });
    expectToolError(res, "CONFIRM_MISMATCH");
    // The error must tell the model how to recover: re-preview for a new token.
    expect(textOf(res)).toContain("WITHOUT confirmToken");
  });

  it("rejects the token in another eligible user's hands (CONFIRM_MISMATCH)", async () => {
    const res = await callTool(USERS.manager, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
      confirmToken,
    });
    expectToolError(res, "CONFIRM_MISMATCH");
  });

  it("rejects the token after its TTL (CONFIRM_EXPIRED)", async () => {
    const res = await callTool(
      USERS.treasurer,
      ["mcp:govern"],
      "issue_levy_run",
      { schemeId, scheduleId, instalment: 1, confirmToken },
      lateDeps,
    );
    expectToolError(res, "CONFIRM_EXPIRED");
  });

  it("confirm executes the run: notices + ledger charges matching the preview", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
      confirmToken,
    });
    const body = payloadOf<{ result: { issued: number; dueOn: string } }>(res);
    expect(body.result.issued).toBe(3);
    expect(body.result.dueOn).toBe("2026-08-01");

    const notices = await tdb.db.query.levyNotices.findMany({
      where: and(eq(levyNotices.schemeId, schemeId), eq(levyNotices.instalment, 1)),
    });
    expect(notices).toHaveLength(3);
    expect(notices.reduce((a, n) => a + n.totalCents, 0)).toBe(15_000);
    const charges = await tdb.db.query.lotLedgerEntries.findMany({
      where: and(eq(lotLedgerEntries.schemeId, schemeId), eq(lotLedgerEntries.kind, "levy_charge")),
    });
    expect(charges).toHaveLength(3);
  });

  it("replaying the confirm cannot double-charge — the domain guard answers ALREADY_ISSUED", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
      confirmToken,
    });
    expectToolError(res, "ALREADY_ISSUED");
    const notices = await tdb.db.query.levyNotices.findMany({
      where: eq(levyNotices.schemeId, schemeId),
    });
    expect(notices).toHaveLength(3); // still exactly one run
  });

  it("previewing an already-issued instalment reports the same conflict the execution would", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "issue_levy_run", {
      schemeId,
      scheduleId,
      instalment: 1,
    });
    expectToolError(res, "ALREADY_ISSUED");
  });
});

// ---------------------------------------------------------------------------
// send_meeting_notice — statutory timing + recipients.
// ---------------------------------------------------------------------------

describe("send_meeting_notice", () => {
  it("preview reports recipients and the ss 72(1)/76(1) timing check without sending", async () => {
    const res = await callTool(USERS.chair, ["mcp:govern"], "send_meeting_notice", {
      schemeId,
      meetingId: agmId,
    });
    const body = payloadOf<{
      confirmToken: string;
      preview: {
        recipients: number;
        ownersWithoutEmail: number;
        statutoryTiming: { noticeDays: number; requiredDays: number; satisfied: boolean };
      };
    }>(res);
    expect(body.preview.recipients).toBe(2);
    expect(body.preview.ownersWithoutEmail).toBe(1);
    expect(body.preview.statutoryTiming).toEqual({
      noticeDays: 35,
      requiredDays: 14,
      satisfied: true,
    });

    const meeting = await tdb.db.query.meetings.findFirst({ where: eq(meetings.id, agmId) });
    expect(meeting!.status).toBe("draft"); // nothing sent

    // …and confirm actually sends it.
    const confirmed = await callTool(USERS.chair, ["mcp:govern"], "send_meeting_notice", {
      schemeId,
      meetingId: agmId,
      confirmToken: body.confirmToken,
    });
    expect(payloadOf<{ result: { recipients: number } }>(confirmed).result.recipients).toBe(2);
    const after = await tdb.db.query.meetings.findFirst({ where: eq(meetings.id, agmId) });
    expect(after!.status).toBe("notice_sent");

    // Replaying the confirm cannot re-blast the statutory notice.
    const replay = await callTool(USERS.chair, ["mcp:govern"], "send_meeting_notice", {
      schemeId,
      meetingId: agmId,
      confirmToken: body.confirmToken,
    });
    expectToolError(replay, "NOTICE_SENT");
  });

  it("preview fails NOTICE_TOO_LATE for a general meeting inside the 14-day window (no token issued)", async () => {
    const res = await callTool(USERS.chair, ["mcp:govern"], "send_meeting_notice", {
      schemeId,
      meetingId: lateMeetingId,
    });
    expectToolError(res, "NOTICE_TOO_LATE");
  });
});

// ---------------------------------------------------------------------------
// resolve_decision — tally + follow-up preview, then real resolution.
// ---------------------------------------------------------------------------

describe("resolve_decision", () => {
  it("preview shows the current tally and the follow-up the executor would fire, then confirm resolves", async () => {
    const res = await callTool(USERS.treasurer, ["mcp:govern"], "resolve_decision", {
      schemeId,
      decisionId: treasurerDecisionId,
      optionId: "approve",
    });
    const body = payloadOf<{
      confirmToken: string;
      preview: {
        currentTally: { votesFor: number; votesAgainst: number; eligible: number };
        projected: { status: string };
        followUp: { action: string } | null;
      };
    }>(res);
    // Treasurer tier: eligible = treasurer + manager_admin.
    expect(body.preview.currentTally).toEqual({ votesFor: 0, votesAgainst: 0, eligible: 2 });
    expect(body.preview.projected.status).toBe("approved");
    expect(body.preview.followUp?.action).toBe("finance.adoptBudget");

    const before = await tdb.db.query.decisions.findFirst({
      where: eq(decisions.id, treasurerDecisionId),
    });
    expect(before!.status).toBe("pending"); // dry-run left it alone

    const confirmed = await callTool(USERS.treasurer, ["mcp:govern"], "resolve_decision", {
      schemeId,
      decisionId: treasurerDecisionId,
      optionId: "approve",
      confirmToken: body.confirmToken,
    });
    expect(payloadOf<{ result: { status: string } }>(confirmed).result.status).toBe("approved");
    const after = await tdb.db.query.decisions.findFirst({
      where: eq(decisions.id, treasurerDecisionId),
    });
    expect(after!.status).toBe("approved");
    expect(after!.decidedByUserId).toBe(USERS.treasurer);

    // Execute-once: the same token replayed hits the resolved guard.
    const replay = await callTool(USERS.treasurer, ["mcp:govern"], "resolve_decision", {
      schemeId,
      decisionId: treasurerDecisionId,
      optionId: "approve",
      confirmToken: body.confirmToken,
    });
    expectToolError(replay, "ALREADY_RESOLVED");
  });
});

// ---------------------------------------------------------------------------
// cast_motion_vote — whose vote / weight / tally, majority forming over votes.
// ---------------------------------------------------------------------------

describe("cast_motion_vote", () => {
  it("previews the caller's ballot and tally, then records it; a second voter forms the majority", async () => {
    // Chair votes first: 1 of 3 eligible — stays pending.
    const chairPreview = await callTool(USERS.chair, ["mcp:govern"], "cast_motion_vote", {
      schemeId,
      decisionId: committeeDecisionId,
      choice: "approve",
    });
    const chairBody = payloadOf<{
      confirmToken: string;
      preview: {
        voter: { userId: string; weight: number; choice: string };
        currentTally: { votesFor: number; votesAgainst: number; eligible: number };
        projected: { status: string };
      };
    }>(chairPreview);
    expect(chairBody.preview.voter).toMatchObject({
      userId: USERS.chair,
      weight: 1,
      choice: "approve",
    });
    expect(chairBody.preview.currentTally).toEqual({ votesFor: 0, votesAgainst: 0, eligible: 3 });
    expect(chairBody.preview.projected.status).toBe("pending");

    const chairCast = await callTool(USERS.chair, ["mcp:govern"], "cast_motion_vote", {
      schemeId,
      decisionId: committeeDecisionId,
      choice: "approve",
      confirmToken: chairBody.confirmToken,
    });
    expect(
      payloadOf<{ result: { status: string; votesFor: number } }>(chairCast).result,
    ).toMatchObject({ status: "pending", votesFor: 1 });

    // The chair cannot vote twice — even the preview says so.
    const again = await callTool(USERS.chair, ["mcp:govern"], "cast_motion_vote", {
      schemeId,
      decisionId: committeeDecisionId,
      choice: "approve",
    });
    expectToolError(again, "ALREADY_VOTED");

    // Treasurer's vote is projected to (and does) form the 2/3 majority.
    const tPreview = await callTool(USERS.treasurer, ["mcp:govern"], "cast_motion_vote", {
      schemeId,
      decisionId: committeeDecisionId,
      choice: "approve",
    });
    const tBody = payloadOf<{
      confirmToken: string;
      preview: { currentTally: { votesFor: number }; projected: { status: string } };
    }>(tPreview);
    expect(tBody.preview.currentTally.votesFor).toBe(1);
    expect(tBody.preview.projected.status).toBe("approved");

    const tCast = await callTool(USERS.treasurer, ["mcp:govern"], "cast_motion_vote", {
      schemeId,
      decisionId: committeeDecisionId,
      choice: "approve",
      confirmToken: tBody.confirmToken,
    });
    expect(payloadOf<{ result: { status: string } }>(tCast).result.status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// close_meeting — what finalises, then the close.
// ---------------------------------------------------------------------------

describe("close_meeting", () => {
  it("preview reports the quorum snapshot and warns about motions left open, without closing", async () => {
    const res = await callTool(USERS.chair, ["mcp:govern"], "close_meeting", {
      schemeId,
      meetingId: closableMeetingId,
    });
    const body = payloadOf<{
      confirmToken: string;
      preview: {
        quorumToRecord: { quorate: boolean; totalLotCount: number };
        motionsLeftOpen: { title: string; status: string }[];
      };
    }>(res);
    expect(body.preview.quorumToRecord.totalLotCount).toBe(3);
    expect(body.preview.quorumToRecord.quorate).toBe(false); // nobody attended
    expect(body.preview.motionsLeftOpen).toEqual([
      expect.objectContaining({ title: "Repaint the lobby", status: "open" }),
    ]);
    expect(textOf(res)).toContain("WARNING");

    const before = await tdb.db.query.meetings.findFirst({
      where: eq(meetings.id, closableMeetingId),
    });
    expect(before!.status).toBe("in_progress"); // dry-run left it alone

    const confirmed = await callTool(USERS.chair, ["mcp:govern"], "close_meeting", {
      schemeId,
      meetingId: closableMeetingId,
      confirmToken: body.confirmToken,
    });
    expect(payloadOf<{ quorum: { quorate: boolean } }>(confirmed).quorum.quorate).toBe(false);
    const after = await tdb.db.query.meetings.findFirst({
      where: eq(meetings.id, closableMeetingId),
    });
    expect(after!.status).toBe("closed");
    expect(after!.quorumMet).toBe(false);

    // Execute-once: replaying the confirm hits ALREADY_CLOSED.
    const replay = await callTool(USERS.chair, ["mcp:govern"], "close_meeting", {
      schemeId,
      meetingId: closableMeetingId,
      confirmToken: body.confirmToken,
    });
    expectToolError(replay, "ALREADY_CLOSED");
  });
});
