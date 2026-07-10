import {
  acceptAgendaItemInput,
  addMotionInput,
  castVoteInput,
  createMeetingInput,
  meetingsService,
  rejectAgendaItemInput,
  submitAgendaItemInput,
  submitProxyInput,
} from "@goodstrata/core";
import { people } from "@goodstrata/db";
import { userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/** The person record linked to the signed-in user in this scheme. */
async function personForUser(deps: AppDeps, schemeId: string, userId: string) {
  return await deps.db.query.people.findFirst({
    where: and(eq(people.schemeId, schemeId), eq(people.userId, userId)),
  });
}

export function meetingsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/meetings", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({ meetings: await meetingsService.listMeetings(ctx, c.get("schemeId")) });
    })
    .post(
      "/:schemeId/meetings",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", createMeetingInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const meeting = await meetingsService.createMeeting(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ meeting }, 201);
      },
    )
    .get("/:schemeId/meetings/:meetingId", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json(
        await meetingsService.meetingDetail(ctx, c.get("schemeId"), c.req.param("meetingId")),
      );
    })
    .post(
      "/:schemeId/meetings/:meetingId/notice",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await meetingsService.sendMeetingNotice(
          ctx,
          c.get("schemeId"),
          c.req.param("meetingId"),
        );
        return c.json(result);
      },
    )
    .post(
      "/:schemeId/meetings/:meetingId/attend",
      requireSchemeMember(deps),
      zv("json", z.object({ mode: z.enum(["in_person", "online", "proxy"]).default("online") })),
      async (c) => {
        const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
        if (!person) {
          return c.json(
            {
              error: {
                code: "NO_PERSON",
                message:
                  "Your login isn't linked to an owner or occupier in this owners corporation yet, so you can't take part in this meeting action. Ask your committee or manager to link your account to your lot on the People page.",
              },
            },
            422,
          );
        }
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const quorum = await meetingsService.recordAttendance(
          ctx,
          c.get("schemeId"),
          c.req.param("meetingId"),
          person.id,
          c.req.valid("json").mode,
        );
        return c.json(quorum);
      },
    )
    .post(
      "/:schemeId/meetings/:meetingId/close",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const quorum = await meetingsService.closeMeeting(
          ctx,
          c.get("schemeId"),
          c.req.param("meetingId"),
        );
        return c.json(quorum);
      },
    )
    .post(
      "/:schemeId/meetings/:meetingId/video/start",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await meetingsService.startVideoMeeting(
          ctx,
          c.get("schemeId"),
          c.req.param("meetingId"),
        );
        return c.json({ url: result.url });
      },
    )
    .post("/:schemeId/meetings/:meetingId/video/join", requireSchemeMember(deps), async (c) => {
      const user = c.get("user");
      const roles = c.get("roles");
      const isOwner =
        roles.includes("manager_admin") ||
        roles.some((r) => r === "chair" || r === "secretary" || r === "treasurer");
      const ctx = deps.serviceContext(userActor(user.id));
      const result = await meetingsService.joinVideoMeeting(
        ctx,
        c.get("schemeId"),
        c.req.param("meetingId"),
        user.name,
        isOwner,
      );
      return c.json({ url: result.url, token: result.token });
    })
    // Statutory owner right: ANY scheme member linked to a person on the roll
    // may propose a motion/agenda item for an upcoming meeting. It lands as a
    // pending agenda item; the officers are notified and accept or reject it.
    .post(
      "/:schemeId/meetings/:meetingId/agenda-items",
      requireSchemeMember(deps),
      zv("json", submitAgendaItemInput),
      async (c) => {
        const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
        if (!person) {
          return c.json(
            {
              error: {
                code: "NO_PERSON",
                message:
                  "Your login isn't linked to an owner or occupier in this owners corporation yet, so you can't take part in this meeting action. Ask your committee or manager to link your account to your lot on the People page.",
              },
            },
            422,
          );
        }
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const agendaItem = await meetingsService.submitAgendaItem(
          ctx,
          c.get("schemeId"),
          c.req.param("meetingId"),
          person.id,
          c.req.valid("json"),
        );
        return c.json({ agendaItem }, 201);
      },
    )
    // Officer review of a pending owner submission: accept turns it into a
    // real agenda item + draft motion; reject records the reason (submitter
    // is notified either way via the notifier).
    .post(
      "/:schemeId/agenda-items/:agendaItemId/accept",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", acceptAgendaItemInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await meetingsService.acceptAgendaItem(
          ctx,
          c.get("schemeId"),
          c.req.param("agendaItemId"),
          c.req.valid("json"),
        );
        return c.json(result);
      },
    )
    .post(
      "/:schemeId/agenda-items/:agendaItemId/reject",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", rejectAgendaItemInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await meetingsService.rejectAgendaItem(
          ctx,
          c.get("schemeId"),
          c.req.param("agendaItemId"),
          c.req.valid("json"),
        );
        return c.json(result);
      },
    )
    .post(
      "/:schemeId/motions",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", addMotionInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const motion = await meetingsService.addMotion(ctx, c.get("schemeId"), c.req.valid("json"));
        return c.json({ motion }, 201);
      },
    )
    .post(
      "/:schemeId/motions/:motionId/open",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json(
          await meetingsService.openMotion(ctx, c.get("schemeId"), c.req.param("motionId")),
        );
      },
    )
    // s 92(3): any lot owner or proxy holder may demand a poll — standing is
    // checked in the service, so this is member-gated rather than officer-gated.
    .post("/:schemeId/motions/:motionId/demand-poll", requireSchemeMember(deps), async (c) => {
      const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
      if (!person) {
        return c.json(
          {
              error: {
                code: "NO_PERSON",
                message:
                  "Your login isn't linked to an owner or occupier in this owners corporation yet, so you can't take part in this meeting action. Ask your committee or manager to link your account to your lot on the People page.",
              },
            },
          422,
        );
      }
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json(
        await meetingsService.demandPoll(
          ctx,
          c.get("schemeId"),
          person.id,
          c.req.param("motionId"),
        ),
      );
    })
    .post(
      "/:schemeId/motions/:motionId/close",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const tally = await meetingsService.closeMotion(
          ctx,
          c.get("schemeId"),
          c.req.param("motionId"),
        );
        return c.json({ tally });
      },
    )
    .post("/:schemeId/votes", requireSchemeMember(deps), zv("json", castVoteInput), async (c) => {
      const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
      if (!person) {
        return c.json(
          {
              error: {
                code: "NO_PERSON",
                message:
                  "Your login isn't linked to an owner or occupier in this owners corporation yet, so you can't take part in this meeting action. Ask your committee or manager to link your account to your lot on the People page.",
              },
            },
          422,
        );
      }
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const vote = await meetingsService.castVote(
        ctx,
        c.get("schemeId"),
        person.id,
        c.req.valid("json"),
      );
      return c.json({ vote }, 201);
    })
    .post(
      "/:schemeId/proxies",
      requireSchemeMember(deps),
      zv("json", submitProxyInput),
      async (c) => {
        const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
        if (!person) {
          return c.json(
            {
              error: {
                code: "NO_PERSON",
                message:
                  "Your login isn't linked to an owner or occupier in this owners corporation yet, so you can't take part in this meeting action. Ask your committee or manager to link your account to your lot on the People page.",
              },
            },
            422,
          );
        }
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const proxy = await meetingsService.submitProxy(
          ctx,
          c.get("schemeId"),
          person.id,
          c.req.valid("json"),
        );
        return c.json({ proxy }, 201);
      },
    );
}
