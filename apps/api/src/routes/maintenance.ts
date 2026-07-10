import {
  createContractorInput,
  createEntityCommentInput,
  createRequestInput,
  entityCommentsService,
  maintenanceService,
  THREAD_OFFICER_ROLES,
} from "@goodstrata/core";
import { people } from "@goodstrata/db";
import type { MembershipRole } from "@goodstrata/shared";
import { userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/**
 * Officer verdict for the comment-thread endpoints. Middleware can't express
 * "requester OR officer", so the service enforces it — the route only reports
 * whether the caller holds an officer role (same set officerOrAdmin accepts,
 * manager_admin included).
 */
const isThreadOfficer = (roles: MembershipRole[]) =>
  roles.some((r) => THREAD_OFFICER_ROLES.includes(r));

// The reporter's identity comes from the session, never the payload — a
// member must not be able to file a report as somebody else.
const reportInput = createRequestInput.omit({ reportedByPersonId: true });

export function maintenanceRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
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
            where: and(eq(people.schemeId, c.get("schemeId")), eq(people.userId, c.get("user").id)),
          });
          const request = await maintenanceService.createMaintenanceRequest(
            ctx,
            c.get("schemeId"),
            { ...c.req.valid("json"), reportedByPersonId: person?.id },
          );
          return c.json({ request }, 201);
        },
      )
      // Comment thread on a request — the requester and the officer tier only
      // (participation is enforced in the service; see entityComments).
      .get("/:schemeId/maintenance/:requestId/comments", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const comments = await entityCommentsService.listComments(
          ctx,
          c.get("schemeId"),
          "maintenance_request",
          c.req.param("requestId"),
          { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
        );
        return c.json({ comments });
      })
      .post(
        "/:schemeId/maintenance/:requestId/comments",
        requireSchemeMember(deps),
        zv("json", createEntityCommentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await entityCommentsService.addComment(
            ctx,
            c.get("schemeId"),
            "maintenance_request",
            c.req.param("requestId"),
            { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      // Soft-delete: the author retracts their own; officers moderate any.
      .delete(
        "/:schemeId/maintenance/comments/:commentId",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await entityCommentsService.deleteComment(
            ctx,
            c.get("schemeId"),
            c.req.param("commentId"),
            { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
          );
          return c.json(result);
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
      )
  );
}
