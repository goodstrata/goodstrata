import type { ResolutionType, VoteChoice } from "@goodstrata/shared";

/**
 * Entitlement-weighted voting under the Owners Corporations Act 2006 (Vic).
 * Pure functions — the meetings service feeds them snapshots.
 *
 * - ordinary: simple majority of votes cast, weighted by lot entitlement
 *   (s 89: owners with unpaid levies cannot vote — enforced at cast time,
 *   so cast votes here are already eligible).
 * - special: at least 75% of the TOTAL entitlements of all lots vote in
 *   favour (abstentions and absences effectively count against).
 * - unanimous: every lot's entitlement votes in favour.
 */

export interface CastVote {
  lotId: string;
  choice: VoteChoice;
  entitlementWeight: number;
}

export interface MotionTally {
  forWeight: number;
  againstWeight: number;
  abstainWeight: number;
  castWeight: number;
  totalEntitlement: number;
  carried: boolean;
  resolutionType: ResolutionType;
}

export function tallyMotion(
  votes: CastVote[],
  totalEntitlement: number,
  resolutionType: ResolutionType,
): MotionTally {
  if (totalEntitlement <= 0) throw new Error("voting: totalEntitlement must be positive");
  const seen = new Set<string>();
  for (const v of votes) {
    if (seen.has(v.lotId)) throw new Error(`voting: duplicate vote for lot ${v.lotId}`);
    seen.add(v.lotId);
    if (v.entitlementWeight <= 0) throw new Error("voting: entitlement weights must be positive");
  }

  const forWeight = sum(votes, "for");
  const againstWeight = sum(votes, "against");
  const abstainWeight = sum(votes, "abstain");
  const castWeight = forWeight + againstWeight + abstainWeight;
  if (castWeight > totalEntitlement) {
    throw new Error("voting: cast weight exceeds total entitlement");
  }

  let carried: boolean;
  switch (resolutionType) {
    case "ordinary":
      carried = forWeight > againstWeight && forWeight > 0;
      break;
    case "special":
      // ≥ 75% of ALL entitlements, not merely of votes cast.
      carried = forWeight * 4 >= totalEntitlement * 3 && forWeight > 0;
      break;
    case "unanimous":
      carried = forWeight === totalEntitlement;
      break;
  }

  return {
    forWeight,
    againstWeight,
    abstainWeight,
    castWeight,
    totalEntitlement,
    carried,
    resolutionType,
  };
}

function sum(votes: CastVote[], choice: VoteChoice): number {
  return votes.filter((v) => v.choice === choice).reduce((a, v) => a + v.entitlementWeight, 0);
}

/**
 * Quorum for general meetings: lots representing at least half the total lot
 * entitlements are present (in person, online, or by proxy).
 */
export function quorumMet(representedEntitlement: number, totalEntitlement: number): boolean {
  if (totalEntitlement <= 0) throw new Error("voting: totalEntitlement must be positive");
  return representedEntitlement * 2 >= totalEntitlement;
}
