import { type Database, eventCursors, eventLog } from "@goodstrata/db";
import type { Actor } from "@goodstrata/shared";
import { asc, eq, gt } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { listenForEvents } from "./listen.js";

/** Hard cap on agent-caused event chains (loop prevention). */
export const MAX_CAUSATION_DEPTH = 5;

export interface EventRecord {
  id: string;
  seq: number;
  schemeId: string | null;
  stream: string;
  type: string;
  payload: unknown;
  actor: Actor;
  correlationId: string;
  causationId: string | null;
  causationDepth: number;
  occurredAt: Date;
}

export interface Subscription {
  /** Unique name, e.g. "agent.echo" — used in job dedupe keys. */
  name: string;
  /** pg-boss queue jobs are fanned out to. */
  queue: string;
  /** Event types this consumer wants, or "*" for everything. */
  types: readonly string[] | "*";
  /** Optional extra predicate (e.g. don't react to your own agent's events). */
  filter?: (evt: EventRecord) => boolean;
  /** Skip events beyond the causation-depth cap (default true for agent queues). */
  enforceDepthCap?: boolean;
}

/** Job payload placed on subscription queues; handlers re-read the event row. */
export interface DispatchJobData {
  eventId: string;
  seq: number;
  type: string;
  schemeId: string | null;
}

const CURSOR_KEY = "dispatcher";
const BATCH = 100;

/**
 * The single dispatcher: tails event_log from a persistent cursor and fans
 * matching events out to pg-boss queues. LISTEN/NOTIFY wakes it instantly;
 * a slow poll and boot-time drain guarantee at-least-once even across
 * downtime. Enqueueing is deduped via singletonKey; handlers must be
 * idempotent on event id regardless.
 */
export class EventDispatcher {
  private stopListen: (() => Promise<void>) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private draining = false;
  private drainAgain = false;
  private stopped = false;

  constructor(
    private readonly opts: {
      db: Database;
      boss: PgBoss;
      connectionString: string;
      subscriptions: Subscription[];
      onError?: (err: Error) => void;
      /** Fallback poll interval ms (NOTIFY is the fast path). */
      pollIntervalMs?: number;
    },
  ) {}

  private get onError() {
    return this.opts.onError ?? ((err: Error) => console.error("[dispatcher]", err));
  }

  async start(): Promise<void> {
    const { db, boss, subscriptions, connectionString } = this.opts;

    for (const sub of subscriptions) {
      await boss.createQueue(sub.queue).catch(() => {}); // exists = fine
    }

    await db
      .insert(eventCursors)
      .values({ consumer: CURSOR_KEY, lastSeq: 0 })
      .onConflictDoNothing();

    this.stopListen = listenForEvents(connectionString, () => void this.drain(), this.onError).stop;

    this.pollTimer = setInterval(() => void this.drain(), this.opts.pollIntervalMs ?? 30_000);
    await this.drain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.stopListen?.();
  }

  /** Drain all events past the cursor. Serialized; concurrent calls coalesce. */
  async drain(): Promise<void> {
    if (this.stopped) return;
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      let more = true;
      while (more && !this.stopped) {
        more = await this.drainBatch();
      }
    } catch (err) {
      this.onError(err as Error);
    } finally {
      this.draining = false;
      if (this.drainAgain) {
        this.drainAgain = false;
        void this.drain();
      }
    }
  }

  private async drainBatch(): Promise<boolean> {
    const { db, boss, subscriptions } = this.opts;

    const cursor = await db.query.eventCursors.findFirst({
      where: eq(eventCursors.consumer, CURSOR_KEY),
    });
    const lastSeq = cursor?.lastSeq ?? 0;

    const rows = await db
      .select()
      .from(eventLog)
      .where(gt(eventLog.seq, lastSeq))
      .orderBy(asc(eventLog.seq))
      .limit(BATCH);

    for (const row of rows) {
      const evt = row as unknown as EventRecord;
      for (const sub of subscriptions) {
        if (sub.types !== "*" && !sub.types.includes(evt.type)) continue;
        if (sub.enforceDepthCap !== false && evt.causationDepth > MAX_CAUSATION_DEPTH) {
          this.onError(
            new Error(
              `loop suppressed: ${evt.type} depth ${evt.causationDepth} > ${MAX_CAUSATION_DEPTH} (event ${evt.id})`,
            ),
          );
          continue;
        }
        if (sub.filter && !sub.filter(evt)) continue;

        const data: DispatchJobData = {
          eventId: evt.id,
          seq: evt.seq,
          type: evt.type,
          schemeId: evt.schemeId,
        };
        await boss.send(sub.queue, { ...data }, { singletonKey: `${sub.name}:${evt.id}` });
      }
      await db
        .update(eventCursors)
        .set({ lastSeq: evt.seq, updatedAt: new Date() })
        .where(eq(eventCursors.consumer, CURSOR_KEY));
    }

    return rows.length === BATCH;
  }
}

/** Re-read a dispatched event's full row (handlers always work from the log). */
export async function loadEvent(db: Database, eventId: string): Promise<EventRecord | null> {
  const row = await db.query.eventLog.findFirst({
    where: eq(eventLog.id, eventId),
  });
  return (row as unknown as EventRecord) ?? null;
}
