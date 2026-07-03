import {
  advanceComplaintInput,
  fileComplaintInput,
  grievancesService,
  issueBreachNoticeInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

/** Officers run the grievance procedure; any member may lodge a complaint. */
const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

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
