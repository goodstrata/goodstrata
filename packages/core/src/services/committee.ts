import { memberships } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { type MembershipRole, toDateOnly } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError } from "../errors.js";

const OFFICE_ROLES: MembershipRole[] = ["chair", "secretary", "treasurer"];
const COMMITTEE_ASSIGNABLE: MembershipRole[] = [...OFFICE_ROLES, "committee_member"];

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
    where: and(eq(memberships.schemeId, schemeId), isNull(memberships.endedOn)),
  });
}
