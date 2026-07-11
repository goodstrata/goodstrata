import { levyNotices, ownerships, paymentAllocations, people } from "@goodstrata/db";
import type { MembershipRole } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { AppDeps } from "./deps.js";

const LOT_REGISTER_ROLES: readonly MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "manager_admin",
];

export function canReadAllLots(roles: readonly MembershipRole[]): boolean {
  return roles.some((role) => LOT_REGISTER_ROLES.includes(role));
}

/** Officers can inspect the whole register; other members can only inspect a current holding. */
export async function canReadLot(
  deps: AppDeps,
  input: { schemeId: string; lotId: string; userId: string; roles: readonly MembershipRole[] },
): Promise<boolean> {
  if (canReadAllLots(input.roles)) return true;
  const row = await deps.db
    .select({ id: ownerships.id })
    .from(ownerships)
    .innerJoin(people, eq(people.id, ownerships.personId))
    .where(
      and(
        eq(ownerships.schemeId, input.schemeId),
        eq(ownerships.lotId, input.lotId),
        eq(people.userId, input.userId),
        isNull(ownerships.endedOn),
      ),
    )
    .limit(1);
  return row.length > 0;
}

/** A receipt can contain allocations for more than one lot. Officers may read
 * any scheme payment; owners must currently own every lot represented on it. */
export async function canReadPayment(
  deps: AppDeps,
  input: { schemeId: string; paymentId: string; userId: string; roles: readonly MembershipRole[] },
): Promise<boolean> {
  if (canReadAllLots(input.roles)) return true;

  const rows = await deps.db
    .selectDistinct({ lotId: levyNotices.lotId })
    .from(paymentAllocations)
    .innerJoin(levyNotices, eq(levyNotices.id, paymentAllocations.levyNoticeId))
    .where(
      and(
        eq(paymentAllocations.paymentId, input.paymentId),
        eq(levyNotices.schemeId, input.schemeId),
      ),
    );
  if (rows.length === 0) return false;

  const checks = await Promise.all(
    rows.map(({ lotId }) =>
      canReadLot(deps, {
        schemeId: input.schemeId,
        lotId,
        userId: input.userId,
        roles: input.roles,
      }),
    ),
  );
  return checks.every(Boolean);
}
