import { complianceService } from "@goodstrata/core";
import { COMPLIANCE_KINDS, COMPLIANCE_STATUSES, userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

/** Closing/waiving an obligation is an officer act; viewing the calendar is not. */
const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

const listQuery = z.object({
  window: z.enum(["upcoming", "overdue", "open", "all"]).optional(),
  kind: z.enum(COMPLIANCE_KINDS).optional(),
  status: z.enum(COMPLIANCE_STATUSES).optional(),
});

const completeBody = z.object({ waived: z.boolean().optional() }).optional();

/**
 * Scheme-scoped view onto the compliance calendar (P1-4). Reads and completions
 * flow through `complianceService`; the service is the sole writer of
 * `compliance_obligations` and this route never touches the table directly.
 */
export function complianceRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      // The calendar: upcoming + overdue obligations for this scheme, any member.
      .get(
        "/:schemeId/compliance",
        requireSchemeMember(deps),
        zv("query", listQuery),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const { window, kind, status } = c.req.valid("query");
          const obligations = await complianceService.listObligations(ctx, {
            schemeId: c.get("schemeId"),
            window: window ?? "open",
            kind,
            status,
          });
          return c.json({ obligations });
        },
      )
      // Mark an obligation done (or waived). Officers only.
      .post(
        "/:schemeId/compliance/:obligationId/complete",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", completeBody),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const obligationId = c.req.param("obligationId");
          // Scope the completion to this scheme: an officer of scheme A must not
          // be able to close scheme B's obligation by guessing its id.
          const existing = await complianceService.getObligation(ctx, obligationId);
          if (!existing || existing.schemeId !== c.get("schemeId")) {
            return c.json(
              { error: { code: "NOT_FOUND", message: "Compliance obligation not found" } },
              404,
            );
          }
          const obligation = await complianceService.completeObligation(ctx, obligationId, {
            waived: c.req.valid("json")?.waived ?? false,
          });
          return c.json({ obligation });
        },
      )
  );
}
