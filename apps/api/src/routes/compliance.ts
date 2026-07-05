import { complianceService } from "@goodstrata/core";
import {
  COMPLIANCE_KINDS,
  COMPLIANCE_STATUSES,
  isRealDateOnly,
  userActor,
} from "@goodstrata/shared";
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
 * Kinds an officer may raise by hand from this scheme-scoped route. Mirrors
 * COMPLIANCE_KINDS minus the two organisation-level kinds
 * (registration_renewal / pi_expiry), which only the manager-registration
 * service raises against the management org.
 */
const SCHEME_RAISABLE_KINDS = [
  "agm_due",
  "insurance_renewal",
  "esm_inspection",
  "financial_statements",
  "bas",
  "valuation",
  "custom",
] as const;

const raiseBody = z.object({
  kind: z.enum(SCHEME_RAISABLE_KINDS),
  title: z.string().trim().min(1).max(200),
  /** ISO date-only (YYYY-MM-DD); must be a real calendar date, not just the right shape. */
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueOn must be an ISO date (YYYY-MM-DD)")
    .refine(isRealDateOnly, "dueOn must be a real calendar date"),
  responsibleRole: z.enum(["chair", "secretary", "treasurer", "manager_admin"]).optional(),
});

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
      // Raise an obligation by hand — a committee deadline the agents don't
      // know about (contract renewal, fire panel service, …). Officers only.
      // Idempotent per (kind, title, dueOn): re-submitting the same deadline
      // returns the existing obligation rather than duplicating it.
      .post(
        "/:schemeId/compliance",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", raiseBody),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const body = c.req.valid("json");
          const obligation = await complianceService.raiseObligation(ctx, {
            schemeId: c.get("schemeId"),
            kind: body.kind,
            title: body.title,
            dueOn: body.dueOn,
            // Same title + same due date = the same obligation.
            subjectRef: `manual:${body.title.toLowerCase()}`,
            periodKey: body.dueOn,
            responsibleRole: body.responsibleRole,
            sourceRef: { manual: true, raisedBy: c.get("user").id },
          });
          return c.json({ obligation }, 201);
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
