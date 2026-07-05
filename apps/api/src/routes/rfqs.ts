import {
  applyRfqSpecInput,
  createRfqInput,
  dispatchRfqInput,
  recordQuoteInput,
  tradeRfqService,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

// requestId comes from the URL, never the payload.
const createRfqBody = createRfqInput.omit({ requestId: true });

export function rfqsRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      .get("/:schemeId/rfqs", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ rfqs: await tradeRfqService.listRfqs(ctx, c.get("schemeId")) });
      })
      // Quotes come back as comparison rows: fee columns are always selected,
      // so every fee disclosure reaches the client unconditionally.
      .get("/:schemeId/rfqs/:rfqId", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json(
          await tradeRfqService.getRfq(ctx, c.get("schemeId"), c.req.param("rfqId")),
        );
      })
      // Officer opens an RFQ on a triaged request. The service drafts an
      // anonymized default spec; the agent refines it before dispatch.
      .post(
        "/:schemeId/requests/:requestId/rfq",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createRfqBody),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const rfq = await tradeRfqService.createRfqFromRequest(ctx, c.get("schemeId"), {
            ...c.req.valid("json"),
            requestId: c.req.param("requestId"),
          });
          return c.json({ rfq }, 201);
        },
      )
      // Officer edits to the drafted spec before dispatch. The service re-runs
      // the anonymization scrub on whatever is submitted, so hand-typed owner
      // details never reach the RFQ columns (the only prose that leaves).
      .post(
        "/:schemeId/rfqs/:rfqId/spec",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", applyRfqSpecInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const rfq = await tradeRfqService.applyRfqSpec(
            ctx,
            c.get("schemeId"),
            c.req.param("rfqId"),
            c.req.valid("json"),
          );
          return c.json({ rfq });
        },
      )
      // Officer-initiated fan-out through the trade-market providers. The
      // outbound posting is built from RFQ columns only (anonymized by
      // construction in the service).
      .post(
        "/:schemeId/rfqs/:rfqId/dispatch",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", dispatchRfqInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await tradeRfqService.dispatchRfq(
            ctx,
            c.get("schemeId"),
            c.req.param("rfqId"),
            c.req.valid("json"),
          );
          return c.json({ result });
        },
      )
      // Manual quote entry (phone/email quotes). recordQuoteInput carries the
      // fee fields, so a quote with a referral kickback cannot be entered
      // fee-blind; the service 422s on an undisclosed fee recipient.
      .post(
        "/:schemeId/rfqs/:rfqId/quotes",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", recordQuoteInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const quote = await tradeRfqService.recordQuote(
            ctx,
            c.get("schemeId"),
            c.req.param("rfqId"),
            c.req.valid("json"),
          );
          return c.json({ quote }, 201);
        },
      )
      // Nominate a quote for award. This only OPENS a committee decision
      // (kind "quote_approval"); the award itself executes as that decision's
      // follow-up after human votes. No route calls awardQuote — it is
      // module-private in core.
      .post(
        "/:schemeId/rfqs/:rfqId/award",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", z.object({ quoteId: z.string() })),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await tradeRfqService.requestAward(
            ctx,
            c.get("schemeId"),
            c.req.param("rfqId"),
            c.req.valid("json").quoteId,
          );
          return c.json({ result }, 201);
        },
      )
  );
}
