import { eventLog } from "@goodstrata/db";
import { listenForEvents } from "@goodstrata/events";
import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDeps } from "./deps.js";
import { type AppEnv, requireSchemeMember } from "./middleware.js";

type Waiter = () => void;

/**
 * One LISTEN connection per process; SSE handlers park on it and re-read
 * event_log by seq when woken (Last-Event-ID gives free resume/catch-up).
 */
export class SseHub {
  private waiters = new Set<Waiter>();
  private stopListen: (() => Promise<void>) | null = null;

  start(connectionString: string): void {
    this.stopListen = listenForEvents(connectionString, () => {
      for (const w of this.waiters) w();
    }).stop;
  }

  async stop(): Promise<void> {
    await this.stopListen?.();
  }

  onWake(waiter: Waiter): () => void {
    this.waiters.add(waiter);
    return () => this.waiters.delete(waiter);
  }
}

export function sseRoutes(deps: AppDeps, hub: SseHub) {
  return new Hono<AppEnv>().get("/:schemeId/stream", requireSchemeMember(deps), async (c) => {
    const schemeId = c.get("schemeId");
    const lastEventId = c.req.header("Last-Event-ID");
    let cursor = lastEventId ? Number.parseInt(lastEventId, 10) || 0 : 0;

    return streamSSE(c, async (stream) => {
      let open = true;
      let wake: Waiter = () => {};
      const unsubscribe = hub.onWake(() => wake());
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        wake();
      });

      const push = async () => {
        const rows = await deps.db
          .select()
          .from(eventLog)
          .where(and(eq(eventLog.schemeId, schemeId), gt(eventLog.seq, cursor)))
          .orderBy(asc(eventLog.seq))
          .limit(200);
        for (const row of rows) {
          cursor = row.seq;
          await stream.writeSSE({
            id: String(row.seq),
            event: "domain-event",
            data: JSON.stringify({
              id: row.id,
              seq: row.seq,
              type: row.type,
              stream: row.stream,
              payload: row.payload,
              actor: row.actor,
              occurredAt: row.occurredAt,
            }),
          });
        }
      };

      // Initial catch-up (or replay from Last-Event-ID), then wake-driven.
      await push();
      while (open) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          // Heartbeat keeps proxies from timing out the stream.
          setTimeout(resolve, 25_000);
        });
        if (!open) break;
        await push();
        await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  });
}
