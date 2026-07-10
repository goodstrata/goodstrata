import {
  announcementsService,
  createAnnouncementInput,
  updateAnnouncementInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

/**
 * The committee noticeboard. Reads are audience-filtered by the caller's
 * roles (a committee-only notice 404s for a plain owner); create/publish are
 * officer-tier only; edit/delete are author-or-officer (checked in the
 * service). manager_admin passes requireRole implicitly.
 */
const officerTier = requireRole("chair", "secretary", "treasurer", "committee_member");

const cursorQuery = z.object({ cursor: z.string().optional() });

export function announcementsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/announcements",
      requireSchemeMember(deps),
      zv("query", cursorQuery),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const page = await announcementsService.listAnnouncements(
          ctx,
          c.get("schemeId"),
          c.get("roles"),
          c.req.valid("query").cursor,
        );
        return c.json(page);
      },
    )
    .get("/:schemeId/announcements/:announcementId", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const announcement = await announcementsService.getAnnouncement(
        ctx,
        c.get("schemeId"),
        c.req.param("announcementId"),
        c.get("roles"),
      );
      return c.json({ announcement });
    })
    .post(
      "/:schemeId/announcements",
      requireSchemeMember(deps),
      officerTier,
      zv("json", createAnnouncementInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const announcement = await announcementsService.createAnnouncement(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ announcement }, 201);
      },
    )
    .post(
      "/:schemeId/announcements/:announcementId/publish",
      requireSchemeMember(deps),
      officerTier,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const announcement = await announcementsService.publishAnnouncement(
          ctx,
          c.get("schemeId"),
          c.req.param("announcementId"),
        );
        return c.json({ announcement });
      },
    )
    .patch(
      "/:schemeId/announcements/:announcementId",
      requireSchemeMember(deps),
      zv("json", updateAnnouncementInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const canManage = announcementsService.isAnnouncementOfficer(c.get("roles"));
        const announcement = await announcementsService.updateAnnouncement(
          ctx,
          c.get("schemeId"),
          c.req.param("announcementId"),
          c.req.valid("json"),
          { userId: c.get("user").id, canManage },
        );
        return c.json({ announcement });
      },
    )
    .delete("/:schemeId/announcements/:announcementId", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const canManage = announcementsService.isAnnouncementOfficer(c.get("roles"));
      const result = await announcementsService.deleteAnnouncement(
        ctx,
        c.get("schemeId"),
        c.req.param("announcementId"),
        { userId: c.get("user").id, canManage },
      );
      return c.json(result);
    });
}
