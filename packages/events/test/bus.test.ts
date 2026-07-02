import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { systemActor } from "@goodstrata/shared";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DispatchJobData, EventDispatcher } from "../src/dispatcher.js";
import { publishEvent } from "../src/publish.js";

let tdb: TestDatabase;
let boss: PgBoss;

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  boss = new PgBoss({ connectionString: tdb.url });
  boss.on("error", () => {});
  await boss.start();
}, 120_000);

afterAll(async () => {
  await boss.stop({ graceful: false });
  await tdb.cleanup();
});

describe("publishEvent", () => {
  it("appends with seq, correlation defaults, and validates payload", async () => {
    const evt = await publishEvent(tdb.db, {
      stream: "scheme:x",
      type: "scheme.created",
      payload: { name: "Test OC", planOfSubdivision: "PS123456A", tier: 5 },
      actor: systemActor("test"),
    });
    expect(evt.seq).toBeGreaterThan(0);
    expect(evt.correlationId).toBeTruthy();
    expect(evt.deduped).toBe(false);
  });

  it("rejects unknown event types and bad payloads", async () => {
    await expect(
      publishEvent(tdb.db, {
        stream: "s",
        // @ts-expect-error unknown type is a runtime error too
        type: "nope.not.real",
        payload: {},
        actor: systemActor("test"),
      }),
    ).rejects.toThrow(/Unknown event type/);

    await expect(
      publishEvent(tdb.db, {
        stream: "s",
        type: "scheme.created",
        payload: { wrong: true },
        actor: systemActor("test"),
      }),
    ).rejects.toThrow();
  });

  it("dedupes on dedupeKey and returns the original event", async () => {
    const first = await publishEvent(tdb.db, {
      stream: "scheme:y",
      type: "scheme.activated",
      payload: {},
      actor: systemActor("test"),
      dedupeKey: "run-1:1",
    });
    const second = await publishEvent(tdb.db, {
      stream: "scheme:y",
      type: "scheme.activated",
      payload: {},
      actor: systemActor("test"),
      dedupeKey: "run-1:1",
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.seq).toBe(first.seq);
  });

  it("rolls back with the domain transaction (outbox semantics)", async () => {
    const before = await countEvents();
    await tdb.db
      .transaction(async (tx) => {
        await publishEvent(tx, {
          stream: "scheme:z",
          type: "scheme.activated",
          payload: {},
          actor: systemActor("test"),
        });
        throw new Error("boom");
      })
      .catch(() => {});
    expect(await countEvents()).toBe(before);
  });
});

describe("EventDispatcher", () => {
  it("fans matching events out to pg-boss queues and advances the cursor", async () => {
    const received: DispatchJobData[] = [];
    const dispatcher = new EventDispatcher({
      db: tdb.db,
      boss,
      connectionString: tdb.url,
      subscriptions: [{ name: "test.consumer", queue: "evt.test", types: ["owner.invited"] }],
      onError: () => {},
      pollIntervalMs: 500,
    });
    await dispatcher.start();
    await boss.work("evt.test", async (jobs) => {
      for (const job of jobs) received.push(job.data as DispatchJobData);
    });

    const evt = await publishEvent(tdb.db, {
      stream: "person:1",
      type: "owner.invited",
      payload: { personId: "p1", email: "o@example.com" },
      actor: systemActor("test"),
    });
    // Non-matching type must not be delivered.
    await publishEvent(tdb.db, {
      stream: "scheme:q",
      type: "scheme.activated",
      payload: {},
      actor: systemActor("test"),
    });

    await waitFor(() => received.length >= 1);
    expect(received).toHaveLength(1);
    expect(received[0]!.eventId).toBe(evt.id);
    await dispatcher.stop();
  });

  it("suppresses events past the causation depth cap", async () => {
    const received: DispatchJobData[] = [];
    const errors: string[] = [];
    const dispatcher = new EventDispatcher({
      db: tdb.db,
      boss,
      connectionString: tdb.url,
      subscriptions: [{ name: "deep.consumer", queue: "evt.deep", types: ["message.sent"] }],
      onError: (e) => errors.push(e.message),
      pollIntervalMs: 500,
    });
    await dispatcher.start();
    await boss.work("evt.deep", async (jobs) => {
      for (const job of jobs) received.push(job.data as DispatchJobData);
    });

    await publishEvent(tdb.db, {
      stream: "m:1",
      type: "message.sent",
      payload: {
        messageId: "m1",
        channel: "email",
        to: "x@example.com",
        subject: null,
        template: null,
      },
      actor: systemActor("test"),
      causationDepth: 99,
    });

    await waitFor(() => errors.some((e) => e.includes("loop suppressed")));
    expect(received).toHaveLength(0);
    await dispatcher.stop();
  });
});

async function countEvents(): Promise<number> {
  const rows = await tdb.db.query.eventLog.findMany({ columns: { id: true } });
  return rows.length;
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
