import {
  AGENT_NAMES,
  AGENT_RUN_STATUSES,
  DECIDER_ROLES,
  DECISION_KINDS,
  DECISION_STATUSES,
} from "@goodstrata/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common.js";
import { users } from "./auth.js";
import { schemes } from "./tenancy.js";

export const agentNameEnum = pgEnum("agent_name", AGENT_NAMES);
export const agentRunStatusEnum = pgEnum("agent_run_status", AGENT_RUN_STATUSES);
export const decisionKindEnum = pgEnum("decision_kind", DECISION_KINDS);
export const decisionStatusEnum = pgEnum("decision_status", DECISION_STATUSES);
export const deciderRoleEnum = pgEnum("decider_role", DECIDER_ROLES);

/**
 * The audit spine. Append-only (UPDATE/DELETE revoked by migration SQL).
 * Every domain mutation writes here in the same transaction.
 */
export const eventLog = pgTable(
  "event_log",
  {
    id: pk(),
    /** Global order for cursors/SSE resume. */
    seq: bigint({ mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    schemeId: uuid().references(() => schemes.id),
    /** Aggregate stream, e.g. "levy_notice:0198…" */
    stream: text().notNull(),
    /** Event type, e.g. "levy.notice.issued" */
    type: text().notNull(),
    payload: jsonb().notNull(),
    actor: jsonb().notNull(),
    correlationId: uuid().notNull(),
    causationId: uuid(),
    causationDepth: integer().notNull().default(0),
    /** Idempotency for agent tool retries: `${runId}:${toolCallId}`. */
    dedupeKey: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_log_seq_idx").on(t.seq),
    uniqueIndex("event_log_dedupe_idx").on(t.dedupeKey),
    index("event_log_scheme_idx").on(t.schemeId, t.seq),
    index("event_log_type_idx").on(t.type),
    index("event_log_correlation_idx").on(t.correlationId),
  ],
);

/** Consumer positions for catch-up scans (NOTIFY is only a wake-up). */
export const eventCursors = pgTable("event_cursors", {
  consumer: text().primaryKey(),
  lastSeq: bigint({ mode: "number" }).notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: pk(),
    schemeId: uuid().references(() => schemes.id),
    agent: agentNameEnum().notNull(),
    triggerEventId: uuid().notNull(),
    correlationId: uuid().notNull(),
    model: text().notNull(),
    status: agentRunStatusEnum().notNull().default("running"),
    /** Deterministic context given to the model. */
    input: jsonb(),
    /** Tool-call transcript, persisted incrementally per step. */
    steps: jsonb().notNull().default([]),
    output: jsonb(),
    error: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    causationDepth: integer().notNull().default(0),
    /** 0 = first attempt; retries insert attempt+1 (see runtime idempotency). */
    attempt: integer().notNull().default(0),
    retryOf: uuid(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    // Retried pg-boss jobs find the existing run instead of double-running.
    uniqueIndex("agent_runs_trigger_idx").on(t.triggerEventId, t.agent, t.attempt),
    index("agent_runs_scheme_idx").on(t.schemeId, t.startedAt),
  ],
);

/**
 * The human gate. Agents request; humans approve/decline; a code executor
 * runs the declarative follow_up on approval.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: decisionKindEnum().notNull(),
    title: text().notNull(),
    /** Agent-written explanation of why this needs a human. */
    summaryMd: text().notNull(),
    /** [{ id, label, description? }] — "approve"/"decline" at minimum. */
    options: jsonb().notNull(),
    /** Supporting facts/links gathered by the agent. */
    evidence: jsonb().notNull().default([]),
    /** What this decision is about: { type: "invoice", id }. */
    subject: jsonb(),
    deciderRole: deciderRoleEnum().notNull(),
    /** Option applied at due_at if the Act permits a default; else escalate. */
    defaultOptionId: text(),
    dueAt: timestamp({ withTimezone: true }),
    /** { type: "action", action, args } | { type: "agent", agent } */
    followUp: jsonb(),
    status: decisionStatusEnum().notNull().default("pending"),
    requestedByRunId: uuid(),
    decidedByUserId: text().references(() => users.id),
    resolution: jsonb(),
    decisionNote: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    remindedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_scheme_status_idx").on(t.schemeId, t.status)],
);

/**
 * Committee ballots on a decision. For "treasurer"-tier decisions a single
 * eligible vote resolves immediately; committee/all_owners tiers tally votes
 * against the count of eligible members (simple majority).
 */
export const decisionVotes = pgTable(
  "decision_votes",
  {
    id: pk(),
    decisionId: uuid()
      .notNull()
      .references(() => decisions.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    /** approve | decline */
    choice: text().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("decision_votes_decision_user_idx").on(t.decisionId, t.userId)],
);

/** Inbound webhook idempotency ledger. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: pk(),
    provider: text().notNull(),
    providerEventId: text().notNull(),
    signatureValid: boolean().notNull(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("webhook_events_provider_idx").on(t.provider, t.providerEventId)],
);
