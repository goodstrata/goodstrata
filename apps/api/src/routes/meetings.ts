import {
  acceptAgendaItemInput,
  addMotionInput,
  appointMeetingChairInput,
  castVoteInput,
  createMeetingInput,
  exerciseCastingVoteInput,
  meetingsService,
  rejectAgendaItemInput,
  submitAgendaItemInput,
  submitPowerOfAttorneyInput,
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
const meetingParams = z.object({ schemeId: z.string().uuid(), meetingId: z.string().uuid() });
const motionParams = z.object({ schemeId: z.string().uuid(), motionId: z.string().uuid() });
const agendaItemParams = z.object({ schemeId: z.string().uuid(), agendaItemId: z.string().uuid() });
const powerOfAttorneyParams = z.object({
  schemeId: z.string().uuid(),
  powerOfAttorneyId: z.string().uuid(),
});

/** The person record linked to the signed-in user in this scheme. */
async function personForUser(deps: AppDeps, schemeId: string, userId: string) {
  return await deps.db.query.people.findFirst({
    where: and(eq(people.schemeId, schemeId), eq(people.userId, userId)),
  });
}

export function meetingsRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      // Validate path identifiers before they reach PostgreSQL. Besides giving
      // clients a useful 422, this prevents malformed deep links from turning
      // into an unhandled `invalid input syntax for type uuid` 500.
      .use("/:schemeId/meetings/:meetingId", zv("param", meetingParams))
      .use("/:schemeId/meetings/:meetingId/*", zv("param", meetingParams))
      .use("/:schemeId/motions/:motionId/*", zv("param", motionParams))
      .use("/:schemeId/agenda-items/:agendaItemId/*", zv("param", agendaItemParams))
      .use("/:schemeId/powers-of-attorney/:powerOfAttorneyId/*", zv("param", powerOfAttorneyParams))
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
        const [detail, person] = await Promise.all([
          meetingsService.meetingDetail(ctx, c.get("schemeId"), c.req.param("meetingId")),
          personForUser(deps, c.get("schemeId"), c.get("user").id),
        ]);
        const roles = c.get("roles");
        const mayAdministerAuthorities = roles.some((role) =>
          ["chair", "secretary", "treasurer", "manager_admin"].includes(role),
        );
        return c.json({
          ...detail,
          powersOfAttorney: detail.powersOfAttorney
            .filter(
              (appointment) =>
                mayAdministerAuthorities ||
                (!!person &&
                  (appointment.donorPersonId === person.id ||
                    appointment.attorneyPersonId === person.id)),
            )
            .map((appointment) => ({
              ...appointment,
              canRevoke:
                !!person && appointment.donorPersonId === person.id && !appointment.revokedAt,
            })),
          canExerciseCastingVote: !!person && detail.meeting.chairPersonId === person.id,
        });
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
        "/:schemeId/meetings/:meetingId/chair",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", appointMeetingChairInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const meeting = await meetingsService.appointMeetingChair(
            ctx,
            c.get("schemeId"),
            c.req.param("meetingId"),
            c.req.valid("json"),
          );
          return c.json({ meeting });
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
      // Human review gate for LLM-drafted minutes: an officer approves the
      // committee-only draft, republishing it owner-visible and notifying members.
      .post(
        "/:schemeId/meetings/:meetingId/minutes/approve",
        requireSchemeMember(deps),
        officerOrAdmin,
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await meetingsService.approveMinutes(
            ctx,
            c.get("schemeId"),
            c.req.param("meetingId"),
          );
          return c.json(result);
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
          const motion = await meetingsService.addMotion(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
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
      .post(
        "/:schemeId/motions/:motionId/casting-vote",
        requireSchemeMember(deps),
        zv("json", exerciseCastingVoteInput),
        async (c) => {
          const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
          if (!person) {
            return c.json(
              {
                error: {
                  code: "NO_PERSON",
                  message: "The meeting chair must be linked to the people roll.",
                },
              },
              422,
            );
          }
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          return c.json(
            await meetingsService.exerciseCastingVote(
              ctx,
              c.get("schemeId"),
              person.id,
              c.req.param("motionId"),
              c.req.valid("json"),
            ),
          );
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
      )
      .post(
        "/:schemeId/powers-of-attorney",
        requireSchemeMember(deps),
        zv("json", submitPowerOfAttorneyInput),
        async (c) => {
          const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
          if (!person) {
            return c.json(
              { error: { code: "NO_PERSON", message: "Your account is not linked to the roll." } },
              422,
            );
          }
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const appointment = await meetingsService.submitPowerOfAttorney(
            ctx,
            c.get("schemeId"),
            person.id,
            c.req.valid("json"),
          );
          return c.json({ powerOfAttorney: appointment }, 201);
        },
      )
      .post(
        "/:schemeId/powers-of-attorney/:powerOfAttorneyId/revoke",
        requireSchemeMember(deps),
        async (c) => {
          const person = await personForUser(deps, c.get("schemeId"), c.get("user").id);
          if (!person) {
            return c.json(
              { error: { code: "NO_PERSON", message: "Your account is not linked to the roll." } },
              422,
            );
          }
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const appointment = await meetingsService.revokePowerOfAttorney(
            ctx,
            c.get("schemeId"),
            person.id,
            c.req.param("powerOfAttorneyId"),
          );
          return c.json({ powerOfAttorney: appointment });
        },
      )
  );
}
