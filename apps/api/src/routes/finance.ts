import {
  arrearsService,
  budgetsService,
  createBudgetInput,
  createLevyScheduleInput,
  decisionsService,
  leviesService,
  paymentsService,
  recordManualPaymentInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

export function financeRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      .get("/:schemeId/budgets", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ budgets: await budgetsService.listBudgets(ctx, c.get("schemeId")) });
      })
      .post(
        "/:schemeId/budgets",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createBudgetInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const budget = await budgetsService.createBudget(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ budget }, 201);
        },
      )
      .get("/:schemeId/levy-schedules", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ schedules: await leviesService.listSchedules(ctx, c.get("schemeId")) });
      })
      .post(
        "/:schemeId/levy-schedules",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createLevyScheduleInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const schedule = await leviesService.createLevySchedule(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ schedule }, 201);
        },
      )
      .post(
        "/:schemeId/levy-schedules/:scheduleId/issue",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", z.object({ instalment: z.number().int().min(1).max(12) })),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await leviesService.issueLevyRun(
            ctx,
            c.get("schemeId"),
            c.req.param("scheduleId"),
            c.req.valid("json").instalment,
          );
          return c.json(result, 201);
        },
      )
      .get("/:schemeId/levy-notices", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ notices: await leviesService.listNotices(ctx, c.get("schemeId")) });
      })
      .get("/:schemeId/payments", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ payments: await paymentsService.listPayments(ctx, c.get("schemeId")) });
      })
      // How owners pay + payments observability (provider, webhook liveness,
      // suspense-queue size). Member-visible: owners need the account details.
      .get("/:schemeId/payments/status", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ status: await paymentsService.paymentsStatus(ctx, c.get("schemeId")) });
      })
      // Manual-payment rail: a treasurer records a bank transfer that arrived
      // outside the provider webhook. Same allocation/receipt/audit chain.
      .post(
        "/:schemeId/payments/manual",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", recordManualPaymentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await paymentsService.recordManualPayment(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json(result, result.duplicate ? 200 : 201);
        },
      )
      // Resolve a parked (unmatched) payment onto a notice.
      .post(
        "/:schemeId/payments/:paymentId/match",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", z.object({ levyNoticeId: z.string() })),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await paymentsService.matchPaymentToNotice(
            ctx,
            c.get("schemeId"),
            c.req.param("paymentId"),
            c.req.valid("json").levyNoticeId,
          );
          return c.json(result);
        },
      )
      .get("/:schemeId/arrears", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ arrears: await arrearsService.arrearsForScheme(ctx, c.get("schemeId")) });
      })
      .get("/:schemeId/lots/:lotId/statement", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json(
          await arrearsService.lotStatement(ctx, c.get("schemeId"), c.req.param("lotId")),
        );
      })
  );
}

export function decisionsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/decisions",
      requireSchemeMember(deps),
      zv(
        "query",
        z.object({
          status: z.enum(["pending", "approved", "declined", "expired", "escalated"]).optional(),
        }),
      ),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const rows = await decisionsService.listDecisions(
          ctx,
          c.get("schemeId"),
          c.req.valid("query").status,
        );
        return c.json({ decisions: rows });
      },
    )
    .post(
      "/:schemeId/decisions/:decisionId/resolve",
      requireSchemeMember(deps),
      zv("json", z.object({ optionId: z.string(), note: z.string().optional() })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const { optionId, note } = c.req.valid("json");
        const result = await decisionsService.resolveDecision(
          ctx,
          c.get("schemeId"),
          c.req.param("decisionId"),
          optionId,
          c.get("roles"),
          note,
        );
        return c.json(result);
      },
    )
    .post(
      "/:schemeId/decisions/:decisionId/vote",
      requireSchemeMember(deps),
      zv("json", z.object({ choice: z.enum(["approve", "decline"]), note: z.string().optional() })),
      async (c) => {
        const user = c.get("user");
        const ctx = deps.serviceContext(userActor(user.id));
        const { choice, note } = c.req.valid("json");
        const result = await decisionsService.castDecisionVote(
          ctx,
          c.get("schemeId"),
          c.req.param("decisionId"),
          user.id,
          choice,
          c.get("roles"),
          note,
        );
        return c.json({
          status: result.status,
          votesFor: result.votesFor,
          votesAgainst: result.votesAgainst,
          eligible: result.eligible,
        });
      },
    )
    .get("/:schemeId/decisions/:decisionId/votes", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const result = await decisionsService.listDecisionVotes(
        ctx,
        c.get("schemeId"),
        c.req.param("decisionId"),
      );
      return c.json(result);
    });
}
