import { meetings, motions } from "@goodstrata/db";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export interface CarriedResolution {
  motion: typeof motions.$inferSelect;
  meeting: typeof meetings.$inferSelect | null;
}

/**
 * Resolve a binding OC motion and reject advisory/draft/lost records. Finance
 * keeps only the motion id; this validator is the shared statutory gate.
 */
export async function requireCarriedResolution(
  ctx: ServiceContext,
  schemeId: string,
  motionId: string,
  options?: { generalMeeting?: boolean; minimum?: "ordinary" | "special" | "unanimous" },
): Promise<CarriedResolution> {
  const motion = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)),
  });
  if (!motion) throw notFound("Resolution");
  if (motion.status !== "carried") {
    throw new DomainError(
      "RESOLUTION_NOT_CARRIED",
      "The authorising resolution must be carried before this financial action can occur",
      422,
    );
  }
  const result = (motion.result ?? {}) as { interim?: boolean; ripenedAt?: string | null };
  if (result.interim && !result.ripenedAt) {
    throw new DomainError(
      "INTERIM_RESOLUTION_PENDING",
      "An interim resolution cannot authorise this action until it has ripened",
      422,
    );
  }

  const rank = { ordinary: 1, special: 2, unanimous: 3 } as const;
  const minimum = options?.minimum ?? "ordinary";
  if (rank[motion.resolutionType] < rank[minimum]) {
    throw new DomainError(
      "RESOLUTION_THRESHOLD_NOT_MET",
      `This action requires at least a ${minimum} resolution`,
      422,
    );
  }

  const meeting = motion.meetingId
    ? ((await ctx.db.query.meetings.findFirst({
        where: and(eq(meetings.id, motion.meetingId), eq(meetings.schemeId, schemeId)),
      })) ?? null)
    : null;
  if (options?.generalMeeting && (!meeting || !["agm", "sgm"].includes(meeting.kind))) {
    throw new DomainError(
      "GENERAL_MEETING_RESOLUTION_REQUIRED",
      "This action must be adopted at an annual or special general meeting",
      422,
    );
  }

  return { motion, meeting };
}
