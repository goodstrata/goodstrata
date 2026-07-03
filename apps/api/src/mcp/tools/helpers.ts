/**
 * Shared helpers for the read-only MCP domain tools: a structured-result
 * builder, a DomainError → tool-error adapter (so a 404/403/validation from
 * @goodstrata/core surfaces its exact code + message instead of a generic
 * crash), the server-side row cap for unbounded lists, and small finance/role
 * utilities the composite tools reuse.
 */
import { DomainError, decisionsService } from "@goodstrata/core";
import type { DeciderRole, MembershipRole } from "@goodstrata/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpAuth, McpScope } from "../auth.js";

/**
 * Assert the OAuth access token carries `scope`, else throw FORBIDDEN naming the
 * missing scope. The write tools call `requireScope(ctx.auth, "mcp:write")` as
 * their first line so a read-only token can never mutate; the govern-scoped
 * money-moving tools (see writes.ts TODO) will layer `"mcp:govern"` on top.
 */
export function requireScope(auth: McpAuth, scope: McpScope): void {
  if (!auth.scopes.includes(scope)) {
    throw new DomainError(
      "FORBIDDEN",
      `This action requires the '${scope}' scope, which this access token was not granted`,
      403,
    );
  }
}

/**
 * Server-side ceiling on any list a tool returns. Prevents a large scheme from
 * flooding a model's context; tools note when a list was truncated.
 */
export const MAX_ROWS = 200;

/** Cap a list and report whether it was truncated. */
export function cap<T>(
  rows: T[],
  max = MAX_ROWS,
): { items: T[]; total: number; truncated: boolean } {
  return { items: rows.slice(0, max), total: rows.length, truncated: rows.length > max };
}

/**
 * Build a tool result: a concise human summary line first, then the full
 * structured JSON payload as a second text block for the model to parse.
 */
export function jsonResult(summary: string, data: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(data, null, 2) },
    ],
  };
}

/**
 * Run a tool body, converting a {@link DomainError} into an `isError` result
 * that carries the core error's code + message (e.g. "NOT_FOUND: Scheme not
 * found"). Non-domain errors propagate to the transport as a JSON-RPC error.
 */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) {
      return { isError: true, content: [{ type: "text", text: `${err.code}: ${err.message}` }] };
    }
    throw err;
  }
}

/** Whether a member holding `roles` may decide a decision of `deciderRole`. */
export function canDecide(roles: MembershipRole[], deciderRole: DeciderRole): boolean {
  const allowed = decisionsService.rolesAllowedToDecide(deciderRole);
  return roles.some((r) => allowed.includes(r));
}

/** Arrears split into standard aging buckets by outstanding cents. */
export function agingBuckets(arrears: { outstandingCents: number; daysOverdue: number }[]): {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
} {
  const b = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const a of arrears) {
    if (a.daysOverdue <= 30) b.d0_30 += a.outstandingCents;
    else if (a.daysOverdue <= 60) b.d31_60 += a.outstandingCents;
    else if (a.daysOverdue <= 90) b.d61_90 += a.outstandingCents;
    else b.d90_plus += a.outstandingCents;
  }
  return b;
}

/** A meeting is "upcoming" if it is scheduled at/after `now` and not closed. */
export function isUpcoming(m: { scheduledAt: Date; status: string }, now: Date): boolean {
  return (
    m.scheduledAt.getTime() >= now.getTime() &&
    m.status !== "closed" &&
    m.status !== "minutes_distributed"
  );
}

/** Maintenance requests still needing attention (not terminal). */
export const OPEN_MAINTENANCE_STATUSES = ["open", "triaged", "quoting", "approved", "in_progress"];

/** Work orders not yet finished. */
export const OPEN_WORK_ORDER_STATUSES = [
  "draft",
  "dispatched",
  "accepted",
  "scheduled",
  "in_progress",
];
