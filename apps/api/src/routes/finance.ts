import {
  adoptBudgetInput,
  arrearsService,
  authoriseInterestInput,
  budgetsService,
  createBudgetInput,
  createLevyScheduleInput,
  createSpecialFeeInput,
  decisionsService,
  executePayoutInput,
  finalFeeNoticesService,
  financialStatementsService,
  interestAuthorisationsService,
  invoicesService,
  issueFinalFeeNoticeInput,
  leviesService,
  paymentsService,
  prepareFinancialStatementInput,
  presentFinancialStatementInput,
  recordFinancialReviewInput,
  recordInvoiceInput,
  recordManualPaymentInput,
  refundPaymentInput,
  writeOffNoticeInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { canReadLot, canReadPayment } from "../lot-access.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");
// Moving money out is the treasurer's act alone (manager_admin always passes).
const treasurerOrAdmin = requireRole("treasurer");

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
      .post(
        "/:schemeId/budgets/:budgetId/adopt",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", adoptBudgetInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const budget = await budgetsService.adoptBudget(
            ctx,
            c.get("schemeId"),
            c.req.param("budgetId"),
            c.req.valid("json").motionId,
          );
          return c.json({ budget });
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
        "/:schemeId/special-fees",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createSpecialFeeInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const schedule = await leviesService.createSpecialFee(
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
      .post(
        "/:schemeId/lots/:lotId/final-fee-notice",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", issueFinalFeeNoticeInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const notice = await finalFeeNoticesService.issueFinalFeeNotice(
            ctx,
            c.get("schemeId"),
            c.req.param("lotId"),
            c.req.valid("json"),
          );
          return c.json({ notice }, 201);
        },
      )
      .get("/:schemeId/financial-statements", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          statements: await financialStatementsService.listFinancialStatements(
            ctx,
            c.get("schemeId"),
          ),
        });
      })
      .post(
        "/:schemeId/financial-statements",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", prepareFinancialStatementInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const statement = await financialStatementsService.prepareFinancialStatement(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ statement }, 201);
        },
      )
      .post(
        "/:schemeId/financial-statements/:statementId/review",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", recordFinancialReviewInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const review = await financialStatementsService.recordFinancialReview(
            ctx,
            c.get("schemeId"),
            c.req.param("statementId"),
            c.req.valid("json"),
          );
          return c.json({ review }, 201);
        },
      )
      .post(
        "/:schemeId/financial-statements/:statementId/present",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", presentFinancialStatementInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const statement = await financialStatementsService.presentFinancialStatement(
            ctx,
            c.get("schemeId"),
            c.req.param("statementId"),
            c.req.valid("json").meetingId,
          );
          return c.json({ statement });
        },
      )
      .get("/:schemeId/interest-authorisations", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          authorisations: await interestAuthorisationsService.listInterestAuthorisations(
            ctx,
            c.get("schemeId"),
          ),
        });
      })
      .post(
        "/:schemeId/interest-authorisations",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", authoriseInterestInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const authorisation = await interestAuthorisationsService.authoriseInterest(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ authorisation }, 201);
        },
      )
      // Write off an uncollectible levy notice: status transition, balancing
      // ledger adjustment and a typed event, all committed together.
      .post(
        "/:schemeId/levy-notices/:noticeId/write-off",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", writeOffNoticeInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await leviesService.writeOffLevyNotice(
            ctx,
            c.get("schemeId"),
            c.req.param("noticeId"),
            c.req.valid("json").reason,
          );
          return c.json(result);
        },
      )
      .get("/:schemeId/payments", requireSchemeMember(deps), async (c) => {
        const schemeId = c.get("schemeId");
        const userId = c.get("user").id;
        const roles = c.get("roles");
        const ctx = deps.serviceContext(userActor(userId));
        const rows = await paymentsService.listPayments(ctx, schemeId);
        const readable = await Promise.all(
          rows.map((payment) =>
            canReadPayment(deps, { schemeId, paymentId: payment.id, userId, roles }),
          ),
        );
        return c.json({ payments: rows.filter((_payment, index) => readable[index]) });
      })
      // How owners pay + payments observability (provider, webhook liveness,
      // suspense-queue size). Member-visible: owners need the account details.
      .get("/:schemeId/payments/status", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ status: await paymentsService.paymentsStatus(ctx, c.get("schemeId")) });
      })
      // A notification may point an owner at one payment without exposing the
      // scheme-wide payments register. All allocated lots must belong to them.
      .get("/:schemeId/payments/:paymentId", requireSchemeMember(deps), async (c) => {
        const schemeId = c.get("schemeId");
        const paymentId = c.req.param("paymentId");
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const payment = (await paymentsService.listPayments(ctx, schemeId)).find(
          (row) => row.id === paymentId,
        );
        if (!payment) {
          return c.json({ error: { code: "NOT_FOUND", message: "Payment not found" } }, 404);
        }
        const allowed = await canReadPayment(deps, {
          schemeId,
          paymentId,
          userId: c.get("user").id,
          roles: c.get("roles"),
        });
        if (!allowed) {
          return c.json({ error: { code: "NOT_FOUND", message: "Payment not found" } }, 404);
        }
        return c.json({ payment });
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
      // Accounts payable — supplier invoices. Member-visible reads (owners can
      // see where their money goes); recording is an officer act.
      .get("/:schemeId/invoices", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ invoices: await invoicesService.listInvoices(ctx, c.get("schemeId")) });
      })
      .post(
        "/:schemeId/invoices",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", recordInvoiceInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await invoicesService.recordInvoice(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      .get("/:schemeId/invoices/:invoiceId", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json(
          await invoicesService.getInvoice(ctx, c.get("schemeId"), c.req.param("invoiceId")),
        );
      })
      .get("/:schemeId/payouts", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ payouts: await invoicesService.listPayouts(ctx, c.get("schemeId")) });
      })
      // Manual payout rail: the treasurer records that the approved transfer
      // was made (bank reference + date). Settles the payout, marks the
      // invoice paid, posts the fund outflow — the reconciliation's cash-out side.
      .post(
        "/:schemeId/payouts/:payoutId/execute",
        requireSchemeMember(deps),
        treasurerOrAdmin,
        zv("json", executePayoutInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await invoicesService.executePayout(
            ctx,
            c.get("schemeId"),
            c.req.param("payoutId"),
            c.req.valid("json"),
          );
          return c.json(result);
        },
      )
      // Refund/reverse a recorded payment: allocations, ledger credits and
      // fund splits are unwound and a typed event published, idempotently.
      .post(
        "/:schemeId/payments/:paymentId/refund",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", refundPaymentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await paymentsService.refundPayment(
            ctx,
            c.get("schemeId"),
            c.req.param("paymentId"),
            c.req.valid("json").reason,
          );
          return c.json(result);
        },
      )
      .get("/:schemeId/arrears", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ arrears: await arrearsService.arrearsForScheme(ctx, c.get("schemeId")) });
      })
      .get("/:schemeId/lots/:lotId/statement", requireSchemeMember(deps), async (c) => {
        const allowed = await canReadLot(deps, {
          schemeId: c.get("schemeId"),
          lotId: c.req.param("lotId"),
          userId: c.get("user").id,
          roles: c.get("roles"),
        });
        if (!allowed) {
          return c.json({ error: { code: "NOT_FOUND", message: "Lot not found" } }, 404);
        }
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
