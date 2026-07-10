import {
  advanceComplaintInput,
  createEntityCommentInput,
  entityCommentsService,
  fileComplaintInput,
  grievancesService,
  issueBreachNoticeInput,
  THREAD_OFFICER_ROLES,
} from "@goodstrata/core";
import type { MembershipRole } from "@goodstrata/shared";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

/** Officers run the grievance procedure; any member may lodge a complaint. */
const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/**
 * Officer verdict for the comment-thread endpoints. Middleware can't express
 * "complainant OR officer", so the service enforces it (non-participants —
 * the respondent included — get 404, never 403).
 */
const isThreadOfficer = (roles: MembershipRole[]) =>
  roles.some((r) => THREAD_OFFICER_ROLES.includes(r));

const reportQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export function grievancesRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      // Lodge a complaint — open to any scheme member (self-service intake).
      .post(
        "/:schemeId/complaints",
        requireSchemeMember(deps),
        zv("json", fileComplaintInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const complaint = await grievancesService.fileComplaint(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ complaint }, 201);
        },
      )
      // A member's own complaints — so they can track the 28-day clock on
      // what they've lodged. Registered before /:complaintId so "mine" never
      // matches as an id.
      .get("/:schemeId/complaints/mine", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          complaints: await grievancesService.listMyComplaints(ctx, c.get("schemeId")),
        });
      })
      // The grievance register and everything downstream is officer-only.
      .get("/:schemeId/complaints", requireSchemeMember(deps), officerOrAdmin, async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          complaints: await grievancesService.listComplaints(ctx, c.get("schemeId")),
        });
      })
      .get(
        "/:schemeId/complaints/:complaintId",
        requireSchemeMember(deps),
        officerOrAdmin,
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const detail = await grievancesService.getComplaintDetail(
            ctx,
            c.get("schemeId"),
            c.req.param("complaintId"),
          );
          return c.json(detail);
        },
      )
      .post(
        "/:schemeId/complaints/:complaintId/advance",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", advanceComplaintInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const complaint = await grievancesService.advanceComplaint(
            ctx,
            c.get("schemeId"),
            c.req.param("complaintId"),
            c.req.valid("json"),
          );
          return c.json({ complaint });
        },
      )
      // Comment thread on a complaint — the complainant and the officer tier
      // only; participation (and 404 confidentiality) enforced in the service.
      .get("/:schemeId/complaints/:complaintId/comments", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const comments = await entityCommentsService.listComments(
          ctx,
          c.get("schemeId"),
          "complaint",
          c.req.param("complaintId"),
          { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
        );
        return c.json({ comments });
      })
      .post(
        "/:schemeId/complaints/:complaintId/comments",
        requireSchemeMember(deps),
        zv("json", createEntityCommentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await entityCommentsService.addComment(
            ctx,
            c.get("schemeId"),
            "complaint",
            c.req.param("complaintId"),
            { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      // Soft-delete: the author retracts their own; officers moderate any.
      .delete("/:schemeId/complaints/comments/:commentId", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await entityCommentsService.deleteComment(
          ctx,
          c.get("schemeId"),
          c.req.param("commentId"),
          { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
        );
        return c.json(result);
      })
      .get("/:schemeId/breach-notices", requireSchemeMember(deps), officerOrAdmin, async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          breachNotices: await grievancesService.listBreachNotices(ctx, c.get("schemeId")),
        });
      })
      .post(
        "/:schemeId/breach-notices",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", issueBreachNoticeInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const breachNotice = await grievancesService.issueBreachNotice(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ breachNotice }, 201);
        },
      )
      // Close out an issued breach notice: rectified, escalated or withdrawn.
      .post(
        "/:schemeId/breach-notices/:breachNoticeId/close",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", grievancesService.closeBreachNoticeInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const breachNotice = await grievancesService.closeBreachNotice(
            ctx,
            c.get("schemeId"),
            c.req.param("breachNoticeId"),
            c.req.valid("json"),
          );
          return c.json({ breachNotice });
        },
      )
      // s 159 grievance report for the AGM.
      .get(
        "/:schemeId/grievances/report",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("query", reportQuery),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const { from, to } = c.req.valid("query");
          const report = await grievancesService.generateS159Report(ctx, c.get("schemeId"), {
            from,
            to,
          });
          return c.json({ report });
        },
      )
  );
}
