import { type DbHandle, decisions, decisionVotes, memberships, users } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  COMMITTEE_ROLES,
  type DeciderRole,
  type DecisionKind,
  type MembershipRole,
} from "@goodstrata/shared";
import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export const decisionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type DecisionOption = z.infer<typeof decisionOptionSchema>;

export interface DecisionFollowUp {
  type: "action";
  /** Registered executor action, e.g. "finance.adoptBudget". */
  action: string;
  args: Record<string, unknown>;
  /** Which option triggers the action (default "approve"). */
  onOptionId?: string;
}

export interface RequestDecisionInput {
  schemeId: string;
  kind: DecisionKind;
  title: string;
  summaryMd: string;
  options?: DecisionOption[];
  evidence?: unknown[];
  subject?: { type: string; id: string };
  deciderRole: DeciderRole;
  defaultOptionId?: string;
  dueAt?: Date;
  followUp?: DecisionFollowUp;
  requestedByRunId?: string;
}

const DEFAULT_OPTIONS: DecisionOption[] = [
  { id: "approve", label: "Approve" },
  { id: "decline", label: "Decline" },
];

/** Open a human decision gate. Everything else in the system stays moving. */
export async function requestDecision(ctx: ServiceContext, input: RequestDecisionInput) {
  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(decisions)
      .values({
        schemeId: input.schemeId,
        kind: input.kind,
        title: input.title,
        summaryMd: input.summaryMd,
        options: input.options ?? DEFAULT_OPTIONS,
        evidence: input.evidence ?? [],
        subject: input.subject ?? null,
        deciderRole: input.deciderRole,
        defaultOptionId: input.defaultOptionId ?? null,
        dueAt: input.dueAt ?? null,
        followUp: input.followUp ?? null,
        requestedByRunId: input.requestedByRunId ?? null,
      })
      .returning();
    const decision = rows[0]!;

    await publishEvent(tx, {
      schemeId: input.schemeId,
      stream: `decision:${decision.id}`,
      type: "decision.requested",
      payload: {
        decisionId: decision.id,
        kind: decision.kind,
        title: decision.title,
        deciderRole: decision.deciderRole,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return decision;
  });
}

/** Which membership roles may decide for a given decider tier. */
export function rolesAllowedToDecide(deciderRole: DeciderRole): readonly MembershipRole[] {
  switch (deciderRole) {
    case "treasurer":
      return ["treasurer", "manager_admin"];
    case "committee":
      return [...COMMITTEE_ROLES, "manager_admin"];
    case "all_owners":
      return ["owner", ...COMMITTEE_ROLES, "manager_admin"];
    default: {
      // deciderRole comes from a DB column, so an unexpected value can reach
      // runtime. Fail with a domain error, not an opaque downstream TypeError.
      const exhaustive: never = deciderRole;
      throw new DomainError(
        "UNKNOWN_DECIDER_ROLE",
        `Unknown decider role: ${String(exhaustive)}`,
        422,
      );
    }
  }
}

/**
 * Finalize a pending decision inside the caller's transaction: status flip +
 * decision.resolved event. The single write path for every resolution route
 * (direct treasurer resolve, committee majority, decline lock-out).
 */
async function finalizeDecision(
  tx: DbHandle,
  ctx: ServiceContext,
  decision: { id: string; schemeId: string },
  optionId: string,
  userId: string,
  note?: string,
) {
  const status = optionId === "decline" ? ("declined" as const) : ("approved" as const);
  await tx
    .update(decisions)
    .set({
      status,
      decidedByUserId: userId,
      resolution: { optionId },
      decisionNote: note ?? null,
      resolvedAt: ctx.clock.now(),
    })
    .where(eq(decisions.id, decision.id));

  await publishEvent(tx, {
    schemeId: decision.schemeId,
    stream: `decision:${decision.id}`,
    type: "decision.resolved",
    payload: { decisionId: decision.id, optionId, resolvedBy: userId },
    actor: ctx.actor,
    ...causationFields(ctx),
  });

  return { decisionId: decision.id, status, optionId };
}

/**
 * Distinct users currently eligible to vote on a decision of this tier. A
 * membership whose login has since been deleted (`userId` SET NULL) can't
 * cast a ballot, so it's excluded from the eligible/majority denominator.
 */
async function countEligibleVoters(
  tx: DbHandle,
  schemeId: string,
  deciderRole: DeciderRole,
): Promise<number> {
  const allowed = rolesAllowedToDecide(deciderRole);
  const rows = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.schemeId, schemeId),
        inArray(memberships.role, [...allowed]),
        isNull(memberships.endedOn),
        isNotNull(memberships.userId),
      ),
    );
  return rows.length;
}

export type DecisionVoteChoice = "approve" | "decline";

export interface CastVoteResult {
  decisionId: string;
  status: "pending" | "approved" | "declined";
  votesFor: number;
  votesAgainst: number;
  eligible: number;
}

/**
 * Record a committee member's vote and tally.
 *
 * - "treasurer"-tier decisions: a single eligible vote resolves immediately.
 * - "committee"/"all_owners" tiers: simple majority of eligible voters.
 *   Approvals win once they exceed half the eligible count; the decision is
 *   declined as soon as approvals can no longer reach a majority.
 */
export async function castDecisionVote(
  ctx: ServiceContext,
  schemeId: string,
  decisionId: string,
  userId: string,
  choice: DecisionVoteChoice,
  deciderRoles: MembershipRole[],
  note?: string,
): Promise<CastVoteResult> {
  return await ctx.db.transaction(async (tx) => {
    const decision = await tx.query.decisions.findFirst({
      where: and(eq(decisions.id, decisionId), eq(decisions.schemeId, schemeId)),
    });
    if (!decision) throw notFound("Decision");
    if (decision.status !== "pending") {
      throw new DomainError("ALREADY_RESOLVED", "This decision has already been resolved", 409);
    }

    const allowed = rolesAllowedToDecide(decision.deciderRole);
    if (!deciderRoles.some((r) => allowed.includes(r))) {
      throw new DomainError(
        "FORBIDDEN",
        `This decision is for the ${decision.deciderRole.replace("_", " ")}`,
        403,
      );
    }

    const inserted = await tx
      .insert(decisionVotes)
      .values({ decisionId, userId, choice, note: note ?? null })
      .onConflictDoNothing({ target: [decisionVotes.decisionId, decisionVotes.userId] })
      .returning();
    if (inserted.length === 0) {
      throw new DomainError("ALREADY_VOTED", "You have already voted on this decision", 409);
    }

    const allVotes = await tx.query.decisionVotes.findMany({
      where: eq(decisionVotes.decisionId, decisionId),
    });
    const votesFor = allVotes.filter((v) => v.choice === "approve").length;
    const votesAgainst = allVotes.filter((v) => v.choice === "decline").length;
    const eligible = await countEligibleVoters(tx, schemeId, decision.deciderRole);

    let status: CastVoteResult["status"] = "pending";
    if (decision.deciderRole === "treasurer") {
      // Single-officer tier: one eligible vote resolves immediately (as before).
      status = (await finalizeDecision(tx, ctx, decision, choice, userId, note)).status;
    } else if (votesFor > eligible / 2) {
      status = (await finalizeDecision(tx, ctx, decision, "approve", userId, note)).status;
    } else if (votesAgainst >= eligible / 2) {
      // Approvals can no longer reach a majority.
      status = (await finalizeDecision(tx, ctx, decision, "decline", userId, note)).status;
    }

    await publishEvent(tx, {
      schemeId,
      stream: `decision:${decisionId}`,
      type: "decision.vote.cast",
      payload: { decisionId, choice, votesFor, votesAgainst, eligible },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return { decisionId, status, votesFor, votesAgainst, eligible };
  });
}

/** Votes with voter names, plus the running tally and eligible-voter count. */
export async function listDecisionVotes(ctx: ServiceContext, schemeId: string, decisionId: string) {
  const decision = await ctx.db.query.decisions.findFirst({
    where: and(eq(decisions.id, decisionId), eq(decisions.schemeId, schemeId)),
  });
  if (!decision) throw notFound("Decision");

  const votes = await ctx.db
    .select({
      userId: decisionVotes.userId,
      name: users.name,
      choice: decisionVotes.choice,
      note: decisionVotes.note,
      createdAt: decisionVotes.createdAt,
    })
    .from(decisionVotes)
    .innerJoin(users, eq(decisionVotes.userId, users.id))
    .where(eq(decisionVotes.decisionId, decisionId))
    .orderBy(asc(decisionVotes.createdAt));

  return {
    votes,
    votesFor: votes.filter((v) => v.choice === "approve").length,
    votesAgainst: votes.filter((v) => v.choice === "decline").length,
    eligible: await countEligibleVoters(ctx.db, schemeId, decision.deciderRole),
  };
}

/**
 * Backwards-compatible resolve: casts the caller's vote and lets the tally
 * decide. Treasurer-tier decisions still resolve instantly on one eligible
 * vote; committee tiers may stay "pending" until a majority forms.
 */
export async function resolveDecision(
  ctx: ServiceContext,
  schemeId: string,
  decisionId: string,
  optionId: string,
  deciderRoles: MembershipRole[],
  note?: string,
) {
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Only a user can resolve a decision", 403);
  }
  if (optionId !== "approve" && optionId !== "decline") {
    throw new DomainError("INVALID_OPTION", `Unknown option: ${optionId}`, 422);
  }
  const result = await castDecisionVote(
    ctx,
    schemeId,
    decisionId,
    ctx.actor.id,
    optionId,
    deciderRoles,
    note,
  );
  return { decisionId, status: result.status, optionId };
}

export async function listDecisions(
  ctx: ServiceContext,
  schemeId: string,
  status?: "pending" | "approved" | "declined" | "expired" | "escalated",
) {
  // Left-join the decider so resolved decisions carry a human-readable
  // audit line (who decided) without a second lookup.
  return await ctx.db
    .select({ ...getTableColumns(decisions), decidedByName: users.name })
    .from(decisions)
    .leftJoin(users, eq(decisions.decidedByUserId, users.id))
    .where(
      status
        ? and(eq(decisions.schemeId, schemeId), eq(decisions.status, status))
        : eq(decisions.schemeId, schemeId),
    )
    .orderBy(desc(decisions.createdAt));
}

// ---------------------------------------------------------------------------
// Follow-up executor — code, never an LLM, runs the approved action.
// ---------------------------------------------------------------------------

export type DecisionAction = (
  ctx: ServiceContext,
  args: Record<string, unknown>,
  decision: { id: string; schemeId: string },
) => Promise<void>;

const actionRegistry = new Map<string, DecisionAction>();

export function registerDecisionAction(name: string, action: DecisionAction): void {
  actionRegistry.set(name, action);
}

/**
 * Handle a decision.resolved event: if the chosen option carries a follow-up
 * action, execute it. Idempotency comes from the actions themselves being
 * state-guarded (and the dispatcher's job dedupe).
 */
export async function executeDecisionFollowUp(
  ctx: ServiceContext,
  decisionId: string,
): Promise<{ executed: string | null }> {
  const decision = await ctx.db.query.decisions.findFirst({
    where: eq(decisions.id, decisionId),
  });
  if (!decision?.followUp) return { executed: null };
  if (decision.status !== "approved") return { executed: null };

  const followUp = decision.followUp as DecisionFollowUp;
  const chosen = (decision.resolution as { optionId?: string } | null)?.optionId;
  if ((followUp.onOptionId ?? "approve") !== chosen) return { executed: null };

  const action = actionRegistry.get(followUp.action);
  if (!action) {
    throw new DomainError("UNKNOWN_ACTION", `No executor for action ${followUp.action}`, 500);
  }
  await action(ctx, followUp.args, { id: decision.id, schemeId: decision.schemeId });
  return { executed: followUp.action };
}
