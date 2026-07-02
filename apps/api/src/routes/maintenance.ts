import { createContractorInput, createRequestInput, maintenanceService } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

export function maintenanceRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/maintenance", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({ requests: await maintenanceService.listRequests(ctx, c.get("schemeId")) });
    })
    .post(
      "/:schemeId/maintenance",
      requireSchemeMember(deps),
      zv("json", createRequestInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const request = await maintenanceService.createMaintenanceRequest(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ request }, 201);
      },
    )
    .get("/:schemeId/work-orders", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({
        workOrders: await maintenanceService.listWorkOrders(ctx, c.get("schemeId")),
      });
    })
    .post(
      "/:schemeId/work-orders/:workOrderId/complete",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await maintenanceService.completeWorkOrder(
          ctx,
          c.get("schemeId"),
          c.req.param("workOrderId"),
        );
        return c.json(result);
      },
    )
    .get("/:schemeId/contractors", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({
        contractors: await maintenanceService.listContractors(ctx, c.get("schemeId")),
      });
    })
    .post(
      "/:schemeId/contractors",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", createContractorInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const contractor = await maintenanceService.createContractor(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ contractor }, 201);
      },
    );
}
