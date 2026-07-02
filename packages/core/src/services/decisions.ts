import { decisions } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  COMMITTEE_ROLES,
  type DeciderRole,
  type DecisionKind,
  type MembershipRole,
} from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
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
  }
}

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
  const userId = ctx.actor.id;

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

    const options = decision.options as DecisionOption[];
    const option = options.find((o) => o.id === optionId);
    if (!option) {
      throw new DomainError("INVALID_OPTION", `Unknown option: ${optionId}`, 422);
    }

    const status = optionId === "decline" ? "declined" : "approved";
    await tx
      .update(decisions)
      .set({
        status,
        decidedByUserId: userId,
        resolution: { optionId },
        decisionNote: note ?? null,
        resolvedAt: ctx.clock.now(),
      })
      .where(eq(decisions.id, decisionId));

    await publishEvent(tx, {
      schemeId,
      stream: `decision:${decisionId}`,
      type: "decision.resolved",
      payload: { decisionId, optionId, resolvedBy: userId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return { decisionId, status, optionId };
  });
}

export async function listDecisions(
  ctx: ServiceContext,
  schemeId: string,
  status?: "pending" | "approved" | "declined" | "expired" | "escalated",
) {
  return await ctx.db.query.decisions.findMany({
    where: status
      ? and(eq(decisions.schemeId, schemeId), eq(decisions.status, status))
      : eq(decisions.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
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
  if (!decision || !decision.followUp) return { executed: null };
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
