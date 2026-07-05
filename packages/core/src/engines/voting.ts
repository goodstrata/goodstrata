import type { ResolutionType, VoteChoice } from "@goodstrata/shared";

/**
 * Voting under the Owners Corporations Act 2006 (Vic).
 * Pure functions — the meetings service feeds them snapshots.
 *
 * - ordinary (s 91, s 92): ONE VOTE PER LOT — a simple majority of the votes
 *   CAST decides it. An entitlement poll is used only when DEMANDED under
 *   s 92(3)–(5); passing `pollDemanded` re-tallies by lot entitlement weight.
 *   (s 94: owners with unpaid levies cannot vote — enforced at cast time, so
 *   cast votes here are already eligible.)
 * - special: at least 75% of the TOTAL entitlements of all lots vote in
 *   favour (abstentions and absences effectively count against).
 * - unanimous: every lot's entitlement votes in favour.
 */

export interface CastVote {
  lotId: string;
  choice: VoteChoice;
  entitlementWeight: number;
}

/** Which measure actually decided the motion. */
export type TallyBasis = "headcount" | "entitlement";

export interface MotionTally {
  // Entitlement-weighted sums (used by special/unanimous and by an ordinary poll).
  forWeight: number;
  againstWeight: number;
  abstainWeight: number;
  castWeight: number;
  totalEntitlement: number;
  // Lot headcounts (one vote per lot — the default basis for ordinary resolutions).
  forCount: number;
  againstCount: number;
  abstainCount: number;
  carried: boolean;
  resolutionType: ResolutionType;
  /** True when an entitlement poll was demanded on an ordinary resolution. */
  pollDemanded: boolean;
  /** Which measure decided `carried`: one-vote-per-lot headcount or entitlement. */
  basis: TallyBasis;
}

export function tallyMotion(
  votes: CastVote[],
  totalEntitlement: number,
  resolutionType: ResolutionType,
  pollDemanded = false,
): MotionTally {
  if (totalEntitlement <= 0) throw new Error("voting: totalEntitlement must be positive");
  const seen = new Set<string>();
  for (const v of votes) {
    if (seen.has(v.lotId)) throw new Error(`voting: duplicate vote for lot ${v.lotId}`);
    seen.add(v.lotId);
    if (v.entitlementWeight <= 0) throw new Error("voting: entitlement weights must be positive");
  }

  const forWeight = sumWeight(votes, "for");
  const againstWeight = sumWeight(votes, "against");
  const abstainWeight = sumWeight(votes, "abstain");
  const castWeight = forWeight + againstWeight + abstainWeight;
  if (castWeight > totalEntitlement) {
    throw new Error("voting: cast weight exceeds total entitlement");
  }

  const forCount = count(votes, "for");
  const againstCount = count(votes, "against");
  const abstainCount = count(votes, "abstain");

  let carried: boolean;
  let basis: TallyBasis;
  switch (resolutionType) {
    case "ordinary":
      if (pollDemanded) {
        // s 92(3)–(5): poll demanded — decide by lot entitlement weight.
        carried = forWeight > againstWeight && forWeight > 0;
        basis = "entitlement";
      } else {
        // s 91/s 92: one vote per lot, simple majority of votes cast.
        carried = forCount > againstCount && forCount > 0;
        basis = "headcount";
      }
      break;
    case "special":
      // ≥ 75% of ALL entitlements, not merely of votes cast.
      carried = forWeight * 4 >= totalEntitlement * 3 && forWeight > 0;
      basis = "entitlement";
      break;
    case "unanimous":
      carried = forWeight === totalEntitlement;
      basis = "entitlement";
      break;
    default: {
      // resolutionType arrives from a DB column via an `as`-cast, so a
      // corrupt/legacy value can reach runtime. Fail loudly rather than
      // recording a wrong statutory outcome.
      const exhaustive: never = resolutionType;
      throw new Error(`voting: unknown resolution type ${String(exhaustive)}`);
    }
  }

  return {
    forWeight,
    againstWeight,
    abstainWeight,
    castWeight,
    totalEntitlement,
    forCount,
    againstCount,
    abstainCount,
    carried,
    resolutionType,
    pollDemanded,
    basis,
  };
}

function sumWeight(votes: CastVote[], choice: VoteChoice): number {
  return votes.filter((v) => v.choice === choice).reduce((a, v) => a + v.entitlementWeight, 0);
}

function count(votes: CastVote[], choice: VoteChoice): number {
  return votes.filter((v) => v.choice === choice).length;
}

/**
 * Quorum for general meetings: lots representing at least half the total lot
 * entitlements are present (in person, online, or by proxy).
 */
export function quorumMet(representedEntitlement: number, totalEntitlement: number): boolean {
  if (totalEntitlement <= 0) throw new Error("voting: totalEntitlement must be positive");
  return representedEntitlement * 2 >= totalEntitlement;
}
