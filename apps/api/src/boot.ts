import {
  agentSubscriptions,
  allAgents,
  type RuntimeDeps,
  registerAgentWorkers,
} from "@goodstrata/agents";
import {
  arrearsService,
  complianceService,
  decisionsService,
  documentsService,
  meetingsService,
  notifierService,
} from "@goodstrata/core";
import { pgConfig, schemes } from "@goodstrata/db";
import {
  type DispatchJobData,
  EventDispatcher,
  loadEvent,
  type Subscription,
} from "@goodstrata/events";
import { systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import type { AppDeps } from "./deps.js";

const DECISION_EXECUTE_QUEUE = "decision.execute";
const NOTIFY_QUEUE = "notify";
const CRON_ARREARS = "cron.arrears.daily";
const CRON_RETENTION = "cron.retention.daily";
const MEETING_CONDUCT_QUEUE = "meeting.conduct";
const MEETING_CONDUCT_KICKOFF_QUEUE = "meeting.conduct.kickoff";
/** First conductor tick fires shortly after the video room opens. */
const CONDUCT_FIRST_DELAY_S = 20;
/** Interval between conductor ticks while the meeting runs. */
const CONDUCT_INTERVAL_S = 60;

interface ConductJobData {
  schemeId: string;
  meetingId: string;
  tick: number;
}

export interface BackgroundServices {
  boss: PgBoss;
  dispatcher: EventDispatcher;
  stop(): Promise<void>;
}

/**
 * Start the background machinery: pg-boss, the event dispatcher, one worker
 * per agent, the decision follow-up executor, and cron. Runs in-process with
 * the API by default (self-host floor: one Node process).
 */
export async function startBackground(deps: AppDeps): Promise<BackgroundServices> {
  // pg-boss defaults to a 10-connection pool; it only needs a couple for job
  // maintenance, so cap it to leave headroom on the session pooler for the
  // dispatcher/SSE LISTEN connections.
  const boss = new PgBoss({ ...pgConfig(deps.env.DATABASE_URL), max: 2 });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  // The executor consumes decision.resolved like any other event consumer.
  const executorSubscription: Subscription = {
    name: "decision.execute",
    queue: DECISION_EXECUTE_QUEUE,
    types: ["decision.resolved"],
  };

  // The notifier consumes domain events and writes in-app notifications
  // (plus email/SMS for decision requests). Pure code, never an LLM.
  const notifierSubscription: Subscription = {
    name: "notifier",
    queue: NOTIFY_QUEUE,
    types: notifierService.NOTIFIER_EVENT_TYPES,
  };

  // The conductor kickoff reacts to a video meeting starting by scheduling
  // the first meeting.conduct tick. The loop itself is code (below); the
  // conducting is the chair agent, triggered per tick via dispatcher fan-out.
  const conductKickoffSubscription: Subscription = {
    name: "meeting.conduct.kickoff",
    queue: MEETING_CONDUCT_KICKOFF_QUEUE,
    types: ["meeting.video.started"],
  };

  const dispatcher = new EventDispatcher({
    db: deps.db,
    boss,
    connectionString: deps.env.DATABASE_URL,
    subscriptions: [
      ...agentSubscriptions(allAgents),
      executorSubscription,
      notifierSubscription,
      conductKickoffSubscription,
    ],
  });
  await dispatcher.start();

  const runtimeDeps: RuntimeDeps = {
    resolveModel: deps.resolveModel,
    serviceContext: deps.serviceContext,
  };
  await registerAgentWorkers(boss, deps.db, runtimeDeps, allAgents, (agent, outcome) => {
    if (outcome.kind === "ran") {
      console.log(`[agent:${agent}] run ${outcome.runId} → ${outcome.status}`);
    }
  });

  // Decision follow-up executor: code runs what the human approved.
  await boss.work(DECISION_EXECUTE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as DispatchJobData;
      const event = await loadEvent(deps.db, data.eventId);
      if (!event) continue;
      const payload = event.payload as { decisionId: string };
      const ctx = deps.serviceContext(systemActor("decision-executor"), {
        correlationId: event.correlationId,
        causationId: event.id,
        causationDepth: event.causationDepth + 1,
      });
      const result = await decisionsService.executeDecisionFollowUp(ctx, payload.decisionId);
      if (result.executed) {
        console.log(`[decisions] executed ${result.executed} for ${payload.decisionId}`);
      }
    }
  });

  // Notifier worker: fan events out to in-app notifications (+ email/SMS).
  await boss.work(NOTIFY_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as DispatchJobData;
      const event = await loadEvent(deps.db, data.eventId);
      if (!event) continue;
      const ctx = deps.serviceContext(systemActor("notifier"), {
        correlationId: event.correlationId,
        causationId: event.id,
        causationDepth: event.causationDepth + 1,
      });
      const { created } = await notifierService.handleEventForNotifications(ctx, event);
      if (created > 0) {
        console.log(`[notifier] ${event.type} → ${created} notification(s)`);
      }
    }
  });

  // Meeting conductor: a pg-boss self-rescheduling loop. Each tick publishes
  // meeting.conduct.tick (fresh event → fresh chair-agent run via the normal
  // dispatcher fan-out) and re-enqueues itself until the meeting leaves
  // in_progress or the tick cap trips. singletonKey makes re-enqueues
  // idempotent under pg-boss retries.
  await boss.createQueue(MEETING_CONDUCT_QUEUE).catch(() => {});
  const enqueueConductTick = async (data: ConductJobData, delaySeconds: number) => {
    await boss.send(
      MEETING_CONDUCT_QUEUE,
      { ...data },
      { startAfter: delaySeconds, singletonKey: `meeting.conduct:${data.meetingId}:${data.tick}` },
    );
  };

  await boss.work(MEETING_CONDUCT_KICKOFF_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as DispatchJobData;
      const event = await loadEvent(deps.db, data.eventId);
      if (!event?.schemeId) continue;
      const { meetingId } = event.payload as { meetingId: string };
      await enqueueConductTick(
        { schemeId: event.schemeId, meetingId, tick: 1 },
        CONDUCT_FIRST_DELAY_S,
      );
    }
  });

  await boss.work(MEETING_CONDUCT_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data as ConductJobData;
      const ctx = deps.serviceContext(systemActor("meeting-conductor"));
      const result = await meetingsService.conductTick(
        ctx,
        data.schemeId,
        data.meetingId,
        data.tick,
      );
      if (result.proceed) {
        await enqueueConductTick({ ...data, tick: data.tick + 1 }, CONDUCT_INTERVAL_S);
      } else {
        console.log(
          `[conductor] meeting ${data.meetingId} stopped at tick ${data.tick} (${result.reason})`,
        );
      }
    }
  });

  // Cron: pure code sweeps that evaluate state and emit events. Never an LLM.
  await boss.createQueue(CRON_ARREARS).catch(() => {});
  await boss.schedule(CRON_ARREARS, "0 7 * * *", null, { tz: "Australia/Melbourne" });
  await boss.work(CRON_ARREARS, async () => {
    const ctx = deps.serviceContext(systemActor(CRON_ARREARS));
    const active = await deps.db.query.schemes.findMany({
      where: eq(schemes.status, "active"),
    });
    for (const scheme of active) {
      const { emitted } = await arrearsService.scanArrears(ctx, scheme.id);
      if (emitted.length > 0) {
        console.log(`[cron:arrears] ${scheme.name}: ${emitted.length} stage event(s)`);
      }
    }
    // Age the compliance calendar globally (scheme + manager-level obligations).
    console.log(
      "[cron:compliance]",
      await complianceService.sweep(deps.serviceContext(systemActor("cron.compliance.daily"))),
    );
  });

  // Retention: delete stored objects + de-identify document rows once their
  // retentionUntil date has passed. Global sweep (documents span every
  // scheme), same idempotent-cron shape as the compliance sweep above.
  await boss.createQueue(CRON_RETENTION).catch(() => {});
  await boss.schedule(CRON_RETENTION, "0 8 * * *", null, { tz: "Australia/Melbourne" });
  await boss.work(CRON_RETENTION, async () => {
    const ctx = deps.serviceContext(systemActor(CRON_RETENTION));
    const result = await documentsService.enforceRetention(ctx);
    if (result.purged > 0) {
      console.log(`[cron:retention] purged ${result.purged} of ${result.scanned} due document(s)`);
    }
  });

  return {
    boss,
    dispatcher,
    stop: async () => {
      await dispatcher.stop();
      await boss.stop({ graceful: true });
    },
  };
}
