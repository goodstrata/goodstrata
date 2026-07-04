import { createContractorInput, createRequestInput, maintenanceService } from "@goodstrata/core";
import { people } from "@goodstrata/db";
import { userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

// The reporter's identity comes from the session, never the payload — a
// member must not be able to file a report as somebody else.
const reportInput = createRequestInput.omit({ reportedByPersonId: true });

export function maintenanceRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/maintenance", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({ requests: await maintenanceService.listRequests(ctx, c.get("schemeId")) });
    })
    .post(
      "/:schemeId/maintenance",
      requireSchemeMember(deps),
      zv("json", reportInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const person = await deps.db.query.people.findFirst({
          where: and(
            eq(people.schemeId, c.get("schemeId")),
            eq(people.userId, c.get("user").id),
          ),
        });
        const request = await maintenanceService.createMaintenanceRequest(
          ctx,
          c.get("schemeId"),
          { ...c.req.valid("json"), reportedByPersonId: person?.id },
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
    // Manual fallback for the agent flow: an officer raises a work order on a
    // triaged request. Threshold routing (auto / committee gate / emergency)
    // is decided by code in the service, same as the agent path.
    .post(
      "/:schemeId/work-orders",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", maintenanceService.proposeWorkOrderInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const route = await maintenanceService.proposeWorkOrder(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ route }, 201);
      },
    )
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
