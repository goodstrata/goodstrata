import {
  committeeElectionRecords,
  meetings,
  memberships,
  motions,
  ownerships,
  people,
  schemes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { type MembershipRole, toDateOnly } from "@goodstrata/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError } from "../errors.js";

const OFFICE_ROLES: MembershipRole[] = ["chair", "secretary", "treasurer"];
const COMMITTEE_ASSIGNABLE: MembershipRole[] = [...OFFICE_ROLES, "committee_member"];
const ALL_COMMITTEE_ROLES: MembershipRole[] = [...COMMITTEE_ASSIGNABLE];

export const recordCommitteeElectionInput = z.object({
  meetingId: z.string().uuid(),
  electedUserIds: z.array(z.string().min(1)).min(3).max(12),
  /** Carried ordinary resolution authorising 8–12 members. */
  expansionMotionId: z.string().uuid().optional(),
});
export type RecordCommitteeElectionInput = z.infer<typeof recordCommitteeElectionInput>;

/**
 * Assign a committee role. Statutory offices (chair/secretary/treasurer) are
 * single-holder: the incumbent's membership period is closed, never deleted —
 * history is the register.
 */
export async function assignCommitteeRole(
  ctx: ServiceContext,
  schemeId: string,
  userId: string,
  role: MembershipRole,
) {
  if (!COMMITTEE_ASSIGNABLE.includes(role)) {
    throw new DomainError("INVALID_ROLE", `${role} is not a committee role`, 422);
  }

  const today = toDateOnly(ctx.clock.now());

  await ctx.db.transaction(async (tx) => {
    if (OFFICE_ROLES.includes(role)) {
      await tx
        .update(memberships)
        .set({ endedOn: today })
        .where(
          and(
            eq(memberships.schemeId, schemeId),
            eq(memberships.role, role),
            isNull(memberships.endedOn),
          ),
        );
    }

    const existing = await tx.query.memberships.findMany({
      where: and(
        eq(memberships.schemeId, schemeId),
        eq(memberships.userId, userId),
        eq(memberships.role, role),
        isNull(memberships.endedOn),
      ),
    });
    if (existing.length === 0) {
      await tx.insert(memberships).values({ schemeId, userId, role, startedOn: today });
    }

    await publishEvent(tx, {
      schemeId,
      stream: `scheme:${schemeId}`,
      type: "committee.assigned",
      payload: { userId, role },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
}

/** Current committee (active office/committee memberships). */
export async function listCommittee(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.memberships.findMany({
    where: and(
      eq(memberships.schemeId, schemeId),
      inArray(memberships.role, ALL_COMMITTEE_ROLES),
      isNull(memberships.endedOn),
    ),
  });
}

/**
 * Record the committee elected at an AGM and replace the outgoing committee.
 * Tier 1–3 schemes must elect at least three members; every scheme is capped at
 * seven unless a carried ordinary resolution increases it to at most twelve.
 */
export async function recordCommitteeElection(
  ctx: ServiceContext,
  schemeId: string,
  input: RecordCommitteeElectionInput,
) {
  const parsed = recordCommitteeElectionInput.parse(input);
  const electedUserIds = [...new Set(parsed.electedUserIds)];
  if (electedUserIds.length !== parsed.electedUserIds.length) {
    throw new DomainError("DUPLICATE_CANDIDATE", "Each elected member may appear only once", 422);
  }

  const [scheme, meeting] = await Promise.all([
    ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) }),
    ctx.db.query.meetings.findFirst({
      where: and(eq(meetings.id, parsed.meetingId), eq(meetings.schemeId, schemeId)),
    }),
  ]);
  if (!scheme) throw new DomainError("NOT_FOUND", "Scheme not found", 404);
  if (!meeting) throw new DomainError("NOT_FOUND", "AGM not found", 404);
  if (meeting.kind !== "agm") {
    throw new DomainError("AGM_REQUIRED", "The committee must be elected at an AGM", 422);
  }
  if (meeting.status === "draft") {
    throw new DomainError(
      "NOTICE_REQUIRED",
      "Issue the AGM notice before recording its election",
      409,
    );
  }

  if (electedUserIds.length > 7) {
    if (!parsed.expansionMotionId) {
      throw new DomainError(
        "EXPANSION_RESOLUTION_REQUIRED",
        "A committee larger than seven needs a carried ordinary resolution",
        422,
      );
    }
    const expansion = await ctx.db.query.motions.findFirst({
      where: and(
        eq(motions.id, parsed.expansionMotionId),
        eq(motions.schemeId, schemeId),
        eq(motions.meetingId, meeting.id),
      ),
    });
    const result = (expansion?.result ?? {}) as { interim?: boolean };
    if (
      expansion?.resolutionType !== "ordinary" ||
      expansion.status !== "carried" ||
      result.interim
    ) {
      throw new DomainError(
        "EXPANSION_RESOLUTION_REQUIRED",
        "The expansion resolution must be finally carried at this AGM",
        422,
      );
    }
  }

  // Conservatively require every elected user to be a current lot owner with
  // a linked roll entry. Corporate representatives can be added when their
  // authority model is introduced, rather than accepting an unverifiable name.
  for (const userId of electedUserIds) {
    const person = await ctx.db.query.people.findFirst({
      where: and(eq(people.schemeId, schemeId), eq(people.userId, userId)),
    });
    if (!person) {
      throw new DomainError(
        "CANDIDATE_INELIGIBLE",
        "Every candidate must be linked to the roll",
        422,
      );
    }
    const ownership = await ctx.db.query.ownerships.findFirst({
      where: and(
        eq(ownerships.schemeId, schemeId),
        eq(ownerships.personId, person.id),
        isNull(ownerships.endedOn),
      ),
    });
    if (!ownership) {
      throw new DomainError(
        "CANDIDATE_INELIGIBLE",
        "Every candidate must be a current lot owner",
        422,
      );
    }
  }

  const today = toDateOnly(ctx.clock.now());
  return await ctx.db.transaction(async (tx) => {
    const prior = await tx.query.committeeElectionRecords.findFirst({
      where: eq(committeeElectionRecords.meetingId, meeting.id),
    });
    if (prior)
      throw new DomainError("ELECTION_RECORDED", "This AGM election is already recorded", 409);

    // The outgoing committee stands down when the new committee is elected.
    await tx
      .update(memberships)
      .set({ endedOn: today })
      .where(
        and(
          eq(memberships.schemeId, schemeId),
          inArray(memberships.role, ALL_COMMITTEE_ROLES),
          isNull(memberships.endedOn),
        ),
      );
    await tx.insert(memberships).values(
      electedUserIds.map((userId) => ({
        schemeId,
        userId,
        role: "committee_member" as const,
        startedOn: today,
      })),
    );
    const rows = await tx
      .insert(committeeElectionRecords)
      .values({
        schemeId,
        meetingId: meeting.id,
        electedUserIds,
        expansionMotionId: parsed.expansionMotionId ?? null,
      })
      .returning();
    const election = rows[0]!;
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meeting.id}`,
      type: "committee.elected",
      payload: { electionId: election.id, meetingId: meeting.id, electedUserIds },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return election;
  });
}
