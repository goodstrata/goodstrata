import { randomUUID } from "node:crypto";
import { type DbHandle, eventLog } from "@goodstrata/db";
import type { Actor } from "@goodstrata/shared";
import { type EventType, validatePayload } from "./catalog.js";

export interface PublishInput {
  schemeId?: string | null;
  /** Aggregate stream, e.g. "levy_notice:<uuid>". */
  stream: string;
  type: EventType;
  payload: unknown;
  actor: Actor;
  /** Inherit from the triggering event to keep the causal chain linked. */
  correlationId?: string;
  causationId?: string;
  causationDepth?: number;
  /** Idempotency key (e.g. `${agentRunId}:${toolCallId}`): re-publish is a no-op. */
  dedupeKey?: string;
}

export interface PublishedEvent {
  id: string;
  seq: number;
  correlationId: string;
  deduped: boolean;
}

/**
 * Append an event to the log. Call inside the same transaction as the domain
 * write — the log is the outbox; the dispatcher picks it up after commit.
 */
export async function publishEvent(db: DbHandle, input: PublishInput): Promise<PublishedEvent> {
  const payload = validatePayload(input.type, input.payload);
  const correlationId = input.correlationId ?? randomUUID();

  const rows = await db
    .insert(eventLog)
    .values({
      schemeId: input.schemeId ?? null,
      stream: input.stream,
      type: input.type,
      payload,
      actor: input.actor,
      correlationId,
      causationId: input.causationId ?? null,
      causationDepth: input.causationDepth ?? 0,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: eventLog.dedupeKey })
    .returning({ id: eventLog.id, seq: eventLog.seq });

  const row = rows[0];
  if (row) {
    return { id: row.id, seq: row.seq, correlationId, deduped: false };
  }

  // Dedupe hit — return the existing event so callers stay idempotent.
  if (!input.dedupeKey) throw new Error("publishEvent: insert returned no row without dedupeKey");
  const existing = await db.query.eventLog.findFirst({
    where: (t, { eq }) => eq(t.dedupeKey, input.dedupeKey!),
    columns: { id: true, seq: true, correlationId: true },
  });
  if (!existing) throw new Error("publishEvent: dedupe conflict but existing event not found");
  return {
    id: existing.id,
    seq: existing.seq,
    correlationId: existing.correlationId,
    deduped: true,
  };
}
