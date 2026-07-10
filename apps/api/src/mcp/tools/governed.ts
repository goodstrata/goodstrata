/**
 * MCP GOVERNED tools — the money-moving / statutory surface of the GoodStrata
 * MCP: issue_levy_run, send_meeting_notice, resolve_decision,
 * cast_motion_vote, close_meeting.
 *
 * Every tool here is gated on the `mcp:govern` OAuth scope (a token holding
 * only mcp:write cannot reach them) BEFORE any scheme lookup, then on the same
 * membership/role tier as its HTTP-route equivalent via `ctx.actor` (404 for
 * non-members, officer tier where the route requires it, decider-tier checks
 * left to the decisions service exactly like the routes).
 *
 * On top of that, each tool is TWO-PHASE (see ../confirm.ts):
 * - called WITHOUT `confirmToken` it runs a genuine DRY-RUN — pure reads and
 *   pure engines only, no mutation — returning exactly what would happen
 *   (per-lot levy amounts, notice recipients + statutory timing, vote tallies,
 *   what a close would finalise) plus a short-lived signed confirm token;
 * - called WITH the token (and identical arguments) it verifies the token and
 *   executes for real through the same @goodstrata/core service functions the
 *   HTTP routes call — never through agent tooling, so human and agent writes
 *   share one domain path.
 *
 * Dry-run fidelity: preview validation mirrors the service's own guards
 * (NOT_FOUND / ALREADY_ISSUED / NOTICE_TOO_LATE / ALREADY_VOTED / …), so a
 * preview that succeeds is an execution that would have succeeded at that
 * instant, and a preview that fails names the same domain error the real call
 * would have raised.
 */
import {
  budgetsService,
  calculateLevyRun,
  DomainError,
  decisionsService,
  leviesService,
  meetingsService,
} from "@goodstrata/core";
import {
  decisions,
  levyNotices,
  levySchedules,
  lots,
  meetings,
  motions,
  ownerships,
  people,
  users,
} from "@goodstrata/db";
import {
  addMonthsDateOnly,
  daysBetween,
  formatCents,
  type LevyFrequency,
} from "@goodstrata/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { issueConfirmToken, verifyConfirmToken } from "../confirm.js";
import type { McpToolContext } from "../server.js";
import { canDecide, guard, jsonResult } from "./helpers.js";

/** Officer tier for scheme finances / statutory acts (manager_admin bypasses in ctx.actor). */
const OFFICER_ROLES = ["chair", "secretary", "treasurer"] as const;

/**
 * ss 72(1)/76(1) OC Act 2006 (Vic): ≥14 days' written notice for a general
 * meeting. Mirrors the meetings service's own guard so the dry-run reports the
 * exact statutory check the execution will apply.
 */
const GM_NOTICE_DAYS = 14;

/** Months between instalments per frequency — mirrors the levies service. */
const MONTHS_BETWEEN: Record<LevyFrequency, number> = {
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

/** Shared `confirmToken` input for every governed tool. */
const CONFIRM_ARG = {
  confirmToken: z
    .string()
    .optional()
    .describe(
      "Two-phase confirmation. Omit it to get a DRY-RUN preview of exactly what would happen plus a short-lived confirmToken; call again with IDENTICAL arguments plus that token to execute for real.",
    ),
};

/** Build a dry-run result: summary, preview payload, and the confirm token. */
function previewResult(
  summary: string,
  preview: Record<string, unknown>,
  token: { confirmToken: string; confirmTokenExpiresAt: string },
): CallToolResult {
  return jsonResult(
    `DRY RUN — nothing has been changed. ${summary} To execute, call this tool again with the SAME arguments plus the returned confirmToken (valid until ${token.confirmTokenExpiresAt}).`,
    { dryRun: true, preview, ...token },
  );
}

export function registerGovernedTools(server: McpServer, ctx: McpToolContext): void {
  // ── issue_levy_run ────────────────────────────────────────────────────────
  // MOVES MONEY: charges every lot's ledger and emails statutory levy notices.
  // Officer tier, matching POST /:schemeId/levy-schedules/:scheduleId/issue.
  server.registerTool(
    "issue_levy_run",
    {
      title: "Issue a levy run (two-phase preview → confirm)",
      description:
        "Issue one instalment of a levy schedule: apportions the adopted budget across every lot by liability, charges each lot's ledger, and emails the statutory levy notices. THIS CHARGES OWNERS REAL MONEY. Requires the mcp:govern scope and an officer role (chair, secretary, or treasurer) or manager_admin. Call WITHOUT confirmToken first for a dry-run preview of the per-lot amounts and due date, then confirm with the token.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        scheduleId: z.string().describe("Levy schedule id from get_financial_position"),
        instalment: z
          .number()
          .int()
          .min(1)
          .max(12)
          .describe("Which instalment of the schedule to issue (1-based)"),
        ...CONFIRM_ARG,
      },
      annotations: {
        title: "Issue a levy run (two-phase preview → confirm)",
        readOnlyHint: false,
        destructiveHint: false, // additive: creates notices + ledger charges (irreversible, but never deletes)
        idempotentHint: false,
      },
    },
    ({ schemeId, scheduleId, instalment, confirmToken }) =>
      guard(async () => {
        ctx.requireScope("mcp:govern");
        const { ctx: svc } = await ctx.actor(schemeId, [...OFFICER_ROLES]);
        const args = { schemeId, scheduleId, instalment };

        if (confirmToken) {
          verifyConfirmToken(ctx.deps, ctx.auth, "issue_levy_run", args, confirmToken);
          const result = await leviesService.issueLevyRun(svc, schemeId, scheduleId, instalment);
          return jsonResult(
            `Issued instalment ${instalment}: ${result.issued} levy notices due ${result.dueOn}, charged to each lot's ledger and emailed to the levy recipients.`,
            { result },
          );
        }

        // DRY RUN — the same validation reads the service performs, then the
        // pure levy-calc engine. No notice, ledger entry, or email is created.
        const schedule = await svc.db.query.levySchedules.findFirst({
          where: and(eq(levySchedules.id, scheduleId), eq(levySchedules.schemeId, schemeId)),
        });
        if (!schedule) throw new DomainError("NOT_FOUND", "Levy schedule not found", 404);
        if (instalment < 1 || instalment > schedule.instalments) {
          throw new DomainError(
            "INVALID_INSTALMENT",
            `Instalment must be 1–${schedule.instalments}`,
            422,
          );
        }
        const funds = await budgetsService.getAdoptedBudgetFunds(svc, schemeId, schedule.budgetId);
        const lotRows = await svc.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
        if (lotRows.length === 0) throw new DomainError("NO_LOTS", "No lots to levy", 422);
        const existing = await svc.db.query.levyNotices.findFirst({
          where: and(
            eq(levyNotices.levyScheduleId, scheduleId),
            eq(levyNotices.instalment, instalment),
          ),
        });
        if (existing) {
          throw new DomainError(
            "ALREADY_ISSUED",
            `Instalment ${instalment} is already issued`,
            409,
          );
        }

        const run = calculateLevyRun(
          funds,
          lotRows.map((l) => ({ lotId: l.id, liability: l.liability })),
          schedule.instalments,
        ).filter((r) => r.instalment === instalment);
        const dueOn = addMonthsDateOnly(
          schedule.firstDueOn,
          (instalment - 1) * MONTHS_BETWEEN[schedule.frequency],
        );
        const perLot = run.map((entry) => {
          const lot = lotRows.find((l) => l.id === entry.lotId)!;
          return {
            lotId: entry.lotId,
            lotNumber: lot.lotNumber,
            liability: lot.liability,
            lines: entry.lines,
            totalCents: entry.totalCents,
            total: formatCents(entry.totalCents),
          };
        });
        const totalCents = run.reduce((a, r) => a + r.totalCents, 0);

        return previewResult(
          `Issuing instalment ${instalment} of ${schedule.instalments} (${schedule.frequency}) would charge ${perLot.length} lots a combined ${formatCents(totalCents)}, due ${dueOn}, and email each lot's levy recipient a statutory notice.`,
          { instalment, ofInstalments: schedule.instalments, dueOn, totalCents, perLot },
          issueConfirmToken(ctx.deps, ctx.auth, "issue_levy_run", args),
        );
      }),
  );

  // ── send_meeting_notice ───────────────────────────────────────────────────
  // STATUTORY ACT: starts the ss 72(1)/76(1) notice clock and emails every
  // owner. Officer tier, matching POST /:schemeId/meetings/:meetingId/notice.
  server.registerTool(
    "send_meeting_notice",
    {
      title: "Send a statutory meeting notice (two-phase preview → confirm)",
      description:
        "Email the statutory meeting notice (agenda, and for general meetings the s 72(2) papers) to every owner, moving the meeting from draft to notice_sent. THIS IS A STATUTORY NOTICE with legal timing effects: general meetings need at least 14 days' notice (ss 72(1)/76(1) OC Act (Vic)) and it cannot be unsent. Requires the mcp:govern scope and an officer role or manager_admin. Call WITHOUT confirmToken first for a dry-run of the recipient count and statutory timing check.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        meetingId: z.string().describe("Meeting id (must still be in draft status)"),
        ...CONFIRM_ARG,
      },
      annotations: {
        title: "Send a statutory meeting notice (two-phase preview → confirm)",
        readOnlyHint: false,
        destructiveHint: false, // additive: sends notices + status flip; nothing is deleted
        idempotentHint: false,
      },
    },
    ({ schemeId, meetingId, confirmToken }) =>
      guard(async () => {
        ctx.requireScope("mcp:govern");
        const { ctx: svc } = await ctx.actor(schemeId, [...OFFICER_ROLES]);
        const args = { schemeId, meetingId };

        if (confirmToken) {
          verifyConfirmToken(ctx.deps, ctx.auth, "send_meeting_notice", args, confirmToken);
          const result = await meetingsService.sendMeetingNotice(svc, schemeId, meetingId);
          return jsonResult(
            `Statutory meeting notice sent to ${result.recipients} owner(s); the meeting is now in notice_sent status.`,
            { result },
          );
        }

        // DRY RUN — mirror the service's guards (draft-only, statutory timing)
        // and count the owners the notice blast would reach. No email, no
        // status change.
        const meeting = await svc.db.query.meetings.findFirst({
          where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
        });
        if (!meeting) throw new DomainError("NOT_FOUND", "Meeting not found", 404);
        if (meeting.status !== "draft") {
          throw new DomainError("NOTICE_SENT", "Notice has already been sent", 409);
        }
        const noticeDays = daysBetween(svc.clock.now(), meeting.scheduledAt);
        if (meeting.kind !== "committee" && noticeDays < GM_NOTICE_DAYS) {
          throw new DomainError(
            "NOTICE_TOO_LATE",
            `General meetings need at least ${GM_NOTICE_DAYS} days' notice (meeting is in ${noticeDays})`,
            422,
          );
        }

        const owners = await svc.db
          .selectDistinctOn([people.id], { personId: people.id, email: people.email })
          .from(ownerships)
          .innerJoin(people, eq(ownerships.personId, people.id))
          .where(and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn)))
          .orderBy(people.id);
        const recipients = owners.filter((o) => o.email).length;

        return previewResult(
          `Sending notice of "${meeting.title}" (${meeting.kind.toUpperCase()}, ${meeting.scheduledAt.toISOString()}) would email ${recipients} owner(s)${owners.length - recipients > 0 ? ` (${owners.length - recipients} owner(s) have no email and would be missed)` : ""}. Statutory timing: ${meeting.kind === "committee" ? "no minimum notice for committee meetings" : `${noticeDays} days' notice ≥ the required ${GM_NOTICE_DAYS} (ss 72(1)/76(1))`}.`,
          {
            meeting: {
              id: meeting.id,
              kind: meeting.kind,
              title: meeting.title,
              scheduledAt: meeting.scheduledAt.toISOString(),
              location: meeting.location,
            },
            recipients,
            ownersWithoutEmail: owners.length - recipients,
            statutoryTiming: {
              noticeDays,
              requiredDays: meeting.kind === "committee" ? null : GM_NOTICE_DAYS,
              satisfied: true,
            },
          },
          issueConfirmToken(ctx.deps, ctx.auth, "send_meeting_notice", args),
        );
      }),
  );

  // ── resolve_decision ──────────────────────────────────────────────────────
  // Casts the caller's vote and lets the tally decide; on approval the
  // registered follow-up executor (code, never a model) runs the action —
  // e.g. finance.adoptBudget. Member-gated like POST
  // /:schemeId/decisions/:decisionId/resolve; the decider tier is enforced by
  // the decisions service (and pre-checked here so the dry-run is honest).
  server.registerTool(
    "resolve_decision",
    {
      title: "Resolve a decision gate (two-phase preview → confirm)",
      description:
        "Cast the caller's vote on a pending decision gate and let the tally resolve it: treasurer-tier decisions resolve on one eligible vote; committee/all-owners tiers resolve on a simple majority of eligible voters. ON APPROVAL any attached follow-up action executes (e.g. adopting a budget so levies can issue against it). Requires the mcp:govern scope; the caller must hold the decision's decider role (manager_admin bypasses). Call WITHOUT confirmToken first for a dry-run of the current tally and what would fire.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        decisionId: z.string().describe("Decision id from find_my_pending_actions"),
        optionId: z.enum(["approve", "decline"]).describe("The option to vote for"),
        note: z.string().max(2000).optional().describe("Optional note recorded with the vote"),
        ...CONFIRM_ARG,
      },
      annotations: {
        title: "Resolve a decision gate (two-phase preview → confirm)",
        readOnlyHint: false,
        destructiveHint: true, // finalises the decision irreversibly and may trigger its follow-up executor
        idempotentHint: false,
      },
    },
    ({ schemeId, decisionId, optionId, note, confirmToken }) =>
      guard(async () => {
        ctx.requireScope("mcp:govern");
        const { roles, ctx: svc } = await ctx.actor(schemeId);
        const args = { schemeId, decisionId, optionId, note };

        if (confirmToken) {
          verifyConfirmToken(ctx.deps, ctx.auth, "resolve_decision", args, confirmToken);
          const result = await decisionsService.resolveDecision(
            svc,
            schemeId,
            decisionId,
            optionId,
            roles,
            note,
          );
          return jsonResult(
            result.status === "pending"
              ? `Vote recorded (${optionId}); the decision stays pending until a majority of eligible voters forms.`
              : `Decision ${result.status} (your vote: ${optionId}).${result.status === "approved" ? " Any attached follow-up action will now execute." : ""}`,
            { result },
          );
        }

        const preview = await previewDecisionVote(ctx, svc, roles, schemeId, decisionId, optionId);
        return previewResult(
          `Voting "${optionId}" on "${preview.decision.title}" (${preview.decision.deciderRole} tier) would make the tally ${preview.projected.votesFor}-for / ${preview.projected.votesAgainst}-against of ${preview.currentTally.eligible} eligible → ${preview.projected.status}.${preview.followUp ? ` On approval the executor would run ${preview.followUp.action}.` : ""}`,
          preview,
          issueConfirmToken(ctx.deps, ctx.auth, "resolve_decision", args),
        );
      }),
  );

  // ── cast_motion_vote ──────────────────────────────────────────────────────
  // Records one ballot on a pending decision motion WITHOUT the resolve
  // framing: same service path (decisionsService.castDecisionVote), same
  // member gate as POST /:schemeId/decisions/:decisionId/vote.
  server.registerTool(
    "cast_motion_vote",
    {
      title: "Cast a vote on a decision motion (two-phase preview → confirm)",
      description:
        "Record the caller's ballot (approve/decline) on a pending decision motion. One vote per eligible member; the decision resolves when the tally reaches its threshold (immediately for treasurer-tier, simple majority for committee/all-owners tiers). A vote cannot be changed once cast. Requires the mcp:govern scope; the caller must hold the decision's decider role (manager_admin bypasses). Call WITHOUT confirmToken first for a dry-run showing whose vote it is, its weight, and the current tally.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        decisionId: z.string().describe("Decision id from find_my_pending_actions"),
        choice: z.enum(["approve", "decline"]).describe("The ballot to cast"),
        note: z.string().max(2000).optional().describe("Optional note recorded with the vote"),
        ...CONFIRM_ARG,
      },
      annotations: {
        title: "Cast a vote on a decision motion (two-phase preview → confirm)",
        readOnlyHint: false,
        destructiveHint: false, // additive: appends one immutable ballot (may finalise the tally)
        idempotentHint: false,
      },
    },
    ({ schemeId, decisionId, choice, note, confirmToken }) =>
      guard(async () => {
        ctx.requireScope("mcp:govern");
        const { roles, ctx: svc } = await ctx.actor(schemeId);
        const args = { schemeId, decisionId, choice, note };

        if (confirmToken) {
          verifyConfirmToken(ctx.deps, ctx.auth, "cast_motion_vote", args, confirmToken);
          const result = await decisionsService.castDecisionVote(
            svc,
            schemeId,
            decisionId,
            ctx.auth.userId,
            choice,
            roles,
            note,
          );
          return jsonResult(
            `Vote cast (${choice}). Tally: ${result.votesFor} for / ${result.votesAgainst} against of ${result.eligible} eligible — decision is ${result.status}.`,
            { result },
          );
        }

        const preview = await previewDecisionVote(ctx, svc, roles, schemeId, decisionId, choice);
        return previewResult(
          `${preview.voter.name ?? preview.voter.userId} would cast one "${choice}" ballot (weight ${preview.voter.weight}) on "${preview.decision.title}". Current tally: ${preview.currentTally.votesFor} for / ${preview.currentTally.votesAgainst} against of ${preview.currentTally.eligible} eligible; after this vote the decision would be ${preview.projected.status}.`,
          preview,
          issueConfirmToken(ctx.deps, ctx.auth, "cast_motion_vote", args),
        );
      }),
  );

  // ── close_meeting ─────────────────────────────────────────────────────────
  // STATUTORY ACT: freezes the meeting record (quorum snapshot, transcript
  // archive) and hands off to the minutes agent. Officer tier, matching POST
  // /:schemeId/meetings/:meetingId/close.
  server.registerTool(
    "close_meeting",
    {
      title: "Close a meeting (two-phase preview → confirm)",
      description:
        "Close a meeting: records the final s 77 quorum snapshot, archives any live transcript, and emits meeting.closed — which the minutes agent reacts to by drafting the statutory minutes. Closing does NOT tally open motions; close those first or they stay open. A closed meeting cannot be reopened. Requires the mcp:govern scope and an officer role or manager_admin. Call WITHOUT confirmToken first for a dry-run of what would finalise.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        meetingId: z.string().describe("Meeting id (must not already be closed)"),
        ...CONFIRM_ARG,
      },
      annotations: {
        title: "Close a meeting (two-phase preview → confirm)",
        readOnlyHint: false,
        destructiveHint: true, // finalises the statutory meeting record; cannot be reopened
        idempotentHint: false,
      },
    },
    ({ schemeId, meetingId, confirmToken }) =>
      guard(async () => {
        ctx.requireScope("mcp:govern");
        const { ctx: svc } = await ctx.actor(schemeId, [...OFFICER_ROLES]);
        const args = { schemeId, meetingId };

        if (confirmToken) {
          verifyConfirmToken(ctx.deps, ctx.auth, "close_meeting", args, confirmToken);
          const quorum = await meetingsService.closeMeeting(svc, schemeId, meetingId);
          return jsonResult(
            `Meeting closed. Recorded quorum: ${quorum.representedLotCount}/${quorum.totalLotCount} lots represented (quorate: ${quorum.quorate}). The minutes agent will draft the minutes from the meeting record.`,
            { quorum },
          );
        }

        // DRY RUN — the quorum snapshot that would be recorded, the motions on
        // the meeting (open ones do NOT auto-close), and what finalises next.
        const meeting = await svc.db.query.meetings.findFirst({
          where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
        });
        if (!meeting) throw new DomainError("NOT_FOUND", "Meeting not found", 404);
        if (meeting.status === "closed" || meeting.status === "minutes_distributed") {
          throw new DomainError("ALREADY_CLOSED", "Meeting is already closed", 409);
        }
        const quorum = await meetingsService.quorumStatus(svc, schemeId, meetingId);
        const motionRows = await svc.db.query.motions.findMany({
          where: and(eq(motions.schemeId, schemeId), eq(motions.meetingId, meetingId)),
          orderBy: (t, { asc }) => asc(t.createdAt),
        });
        const stillOpen = motionRows.filter((m) => m.status === "open" || m.status === "draft");

        return previewResult(
          `Closing "${meeting.title}" would record quorum ${quorum.representedLotCount}/${quorum.totalLotCount} lots (quorate: ${quorum.quorate})${meeting.transcriptionStarted ? ", archive the live transcript" : ""} and trigger the minutes agent.${stillOpen.length > 0 ? ` WARNING: ${stillOpen.length} motion(s) are still ${stillOpen.map((m) => m.status).join("/")} and will NOT be tallied by closing — close them first.` : ""}`,
          {
            meeting: {
              id: meeting.id,
              kind: meeting.kind,
              title: meeting.title,
              status: meeting.status,
            },
            quorumToRecord: quorum,
            transcriptWillBeArchived: meeting.transcriptionStarted,
            motions: motionRows.map((m) => ({ id: m.id, title: m.title, status: m.status })),
            motionsLeftOpen: stillOpen.map((m) => ({ id: m.id, title: m.title, status: m.status })),
            minutes: "the minutes agent drafts statutory minutes in response to meeting.closed",
          },
          issueConfirmToken(ctx.deps, ctx.auth, "close_meeting", args),
        );
      }),
  );
}

/**
 * Shared dry-run for the two decision-voting tools: validates exactly what
 * decisionsService.castDecisionVote would (pending / decider tier / not yet
 * voted), then reports whose vote it is, the current tally, the projected
 * outcome, and any follow-up the executor would fire on approval.
 */
async function previewDecisionVote(
  ctx: McpToolContext,
  svc: Parameters<typeof decisionsService.listDecisionVotes>[0],
  roles: Parameters<typeof canDecide>[0],
  schemeId: string,
  decisionId: string,
  choice: "approve" | "decline",
) {
  const decision = await svc.db.query.decisions.findFirst({
    where: and(eq(decisions.id, decisionId), eq(decisions.schemeId, schemeId)),
  });
  if (!decision) throw new DomainError("NOT_FOUND", "Decision not found", 404);
  if (decision.status !== "pending") {
    throw new DomainError("ALREADY_RESOLVED", "This decision has already been resolved", 409);
  }
  if (!canDecide(roles, decision.deciderRole)) {
    throw new DomainError(
      "FORBIDDEN",
      `This decision is for the ${decision.deciderRole.replace("_", " ")}`,
      403,
    );
  }

  const tally = await decisionsService.listDecisionVotes(svc, schemeId, decisionId);
  if (tally.votes.some((v) => v.userId === ctx.auth.userId)) {
    throw new DomainError("ALREADY_VOTED", "You have already voted on this decision", 409);
  }

  // Projection mirrors castDecisionVote's tally rules: treasurer tier resolves
  // on one eligible vote; committee/all_owners need a simple majority of
  // eligible voters (declined once approvals can no longer reach one).
  const votesFor = tally.votesFor + (choice === "approve" ? 1 : 0);
  const votesAgainst = tally.votesAgainst + (choice === "decline" ? 1 : 0);
  let status: "pending" | "approved" | "declined" = "pending";
  if (decision.deciderRole === "treasurer") {
    status = choice === "decline" ? "declined" : "approved";
  } else if (votesFor > tally.eligible / 2) {
    status = "approved";
  } else if (votesAgainst >= tally.eligible / 2) {
    status = "declined";
  }

  const followUp = decision.followUp as {
    action?: string;
    args?: Record<string, unknown>;
    onOptionId?: string;
  } | null;
  const followUpWouldFire =
    !!followUp?.action && status === "approved" && (followUp.onOptionId ?? "approve") === "approve";

  const voterRow = await svc.db.query.users.findFirst({ where: eq(users.id, ctx.auth.userId) });

  return {
    decision: {
      id: decision.id,
      kind: decision.kind,
      title: decision.title,
      deciderRole: decision.deciderRole,
      dueAt: decision.dueAt?.toISOString() ?? null,
    },
    voter: {
      userId: ctx.auth.userId,
      name: voterRow?.name ?? null,
      choice,
      /** Decision-gate ballots are one vote per eligible member. */
      weight: 1,
    },
    currentTally: {
      votesFor: tally.votesFor,
      votesAgainst: tally.votesAgainst,
      eligible: tally.eligible,
    },
    projected: { votesFor, votesAgainst, status },
    followUp: followUpWouldFire
      ? {
          action: followUp!.action!,
          args: followUp!.args ?? {},
          note: "executed by the decision follow-up executor (code, not a model) after approval",
        }
      : null,
  };
}
