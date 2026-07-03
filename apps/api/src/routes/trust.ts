import { reconciliationPeriodInput, trustReconciliationService } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

// Trust-account money is sensitive: only scheme officers / the manager may read
// the reconciled statement or pull the auditor export.
const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/**
 * Per-OC trust reconciliation & audit export (OC Act s 122). Mounted under
 * /schemes so every route is scheme-scoped and membership-guarded.
 */
export function trustRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/trust/statement",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("query", reconciliationPeriodInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const statement = await trustReconciliationService.schemeTrustStatement(
          ctx,
          c.get("schemeId"),
          c.req.valid("query"),
        );
        return c.json({ statement });
      },
    )
    .get(
      "/:schemeId/trust/audit-export",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("query", reconciliationPeriodInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const pack = await trustReconciliationService.exportTrustAudit(
          ctx,
          c.get("schemeId"),
          c.req.valid("query"),
        );
        c.header("content-type", "text/csv; charset=utf-8");
        c.header("content-disposition", `attachment; filename="${pack.filename}"`);
        return c.body(pack.csv);
      },
    );
}
