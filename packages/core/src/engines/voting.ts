import type { ResolutionType, VoteChoice } from "@goodstrata/shared";

/**
 * Voting under the Owners Corporations Act 2006 (Vic), current authorised
 * consolidation (Version 023). Part 4 Div 6 was substituted by No. 4/2021
 * s 42 — the former ss 91–94 are REPEALED; citations below are to the current
 * sections, quoted in docs/legal/statute-map.md §5.
 * Pure functions — the meetings service feeds them snapshots.
 *
 * - ordinary (s 87, s 89(2)): ONE VOTE PER LOT — "a simple majority of votes
 *   cast at the meeting" decides it. An entitlement poll applies only when
 *   DEMANDED under s 89(3)–(5); passing `pollDemanded` re-tallies by lot
 *   entitlement weight. A poll may be demanded "before or after the vote is
 *   taken" (s 89(3)) — see `retallyOnPoll` for the post-vote displacement.
 * - special (s 96): at least 75% of the TOTAL entitlements of all lots vote
 *   in favour (abstentions and absences effectively count against).
 * - unanimous (s 95): every lot's entitlement votes in favour.
 * - arrears (s 89B): owners in arrears cannot vote except where a special or
 *   unanimous resolution is required — see `lotMayVote`. The service enforces
 *   it at cast time, so votes reaching `tallyMotion` are already eligible.
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
  if (pollDemanded && resolutionType !== "ordinary") {
    // s 89(3): a poll may be required only "for an ordinary resolution" —
    // special and unanimous matters are already decided on entitlement.
    throw new Error(
      `voting: a poll may only be demanded on an ordinary resolution (s 89(3)), not ${resolutionType}`,
    );
  }
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
        // s 89(3)–(5): poll demanded — "one vote for each unit of lot
        // entitlement" decides it instead of the show of hands.
        carried = forWeight > againstWeight && forWeight > 0;
        basis = "entitlement";
      } else {
        // s 87 (one vote per lot) + s 89(2): "simple majority of votes cast".
        carried = forCount > againstCount && forCount > 0;
        basis = "headcount";
      }
      break;
    case "special":
      // s 96: 75% of the total lot entitlements of ALL lots, not merely of
      // votes cast. (Limb (a) — ballot/poll basis — applied uniformly; the
      // limb (b) meeting basis is an open counsel question, statute-map §5.3.)
      carried = forWeight * 4 >= totalEntitlement * 3 && forWeight > 0;
      basis = "entitlement";
      break;
    case "unanimous":
      // s 95: the total lot entitlements / total votes of ALL lots in favour.
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

/**
 * s 89(3)/(5): recount an ordinary motion when a poll is demanded AFTER the
 * vote is taken.
 *
 * Statute (Act v023): a lot owner, in person or by proxy, may "before or
 * after the vote is taken for an ordinary resolution, require that a poll be
 * taken based on one vote for each unit of lot entitlement" (s 89(3)); "If a
 * poll is required after the vote is taken … the decision … determined by a
 * simple majority … has no effect and the decision on that matter is the
 * decision of the poll" (s 89(5)).
 *
 * Pure recount over the same cast votes on the entitlement basis — the
 * returned tally DISPLACES any earlier headcount tally for the motion.
 *
 * Demand-window semantics the SERVICE layer must enforce (not knowable here):
 * - s 89(3) operates "at a meeting": a demand is valid from when the motion
 *   is put until the MEETING is closed — including after the motion's own
 *   show-of-hands result was declared. Meeting-less (circular/ballot) motions
 *   sit outside s 89(3).
 * - Standing: the demander must be a lot owner or a proxy (s 89(3)).
 * - On a valid post-declaration demand: re-tally with this function under the
 *   motion row lock, overwrite the recorded result/status with the poll
 *   tally, and record the displacement (s 89(5)) in the event stream.
 * - s 89(4): poll voting "must be by written vote" — each in-app vote is an
 *   authenticated written record, the platform's s 89(4) position (flagged
 *   for counsel, statute-map §5.3).
 */
export function retallyOnPoll(votes: CastVote[], totalEntitlement: number): MotionTally {
  return tallyMotion(votes, totalEntitlement, "ordinary", true);
}

function sumWeight(votes: CastVote[], choice: VoteChoice): number {
  return votes.filter((v) => v.choice === choice).reduce((a, v) => a + v.entitlementWeight, 0);
}

function count(votes: CastVote[], choice: VoteChoice): number {
  return votes.filter((v) => v.choice === choice).length;
}

/**
 * s 89B arrears-bar inputs for one lot. The SERVICE computes them; the engine
 * never sees payment data.
 */
export interface VoterEligibilityInput {
  /** Resolution type of the motion the lot would vote on. */
  resolutionType: ResolutionType;
  /**
   * s 89B(1)/(3): true iff the lot owner "is in arrears for any amount owed"
   * to the owners corporation AND the amount has NOT been "paid in full"
   * within the meaning of s 89B(3) — a payment counts only if made "(a) in
   * cash; or (b) otherwise, not less than 4 business days before the lot
   * owner is required to vote" (cleared funds).
   *
   * The service layer owns the ledger lookup, the cash-vs-electronic method
   * distinction, the business-day arithmetic, and the "required to vote"
   * reference time. The engine treats this flag as ground truth and applies
   * only the s 89B(1) bar and the s 89B(2) carve-out.
   */
  barredByArrears: boolean;
}

/**
 * s 89B: may this lot vote on a resolution of this type?
 *
 * - s 89B(1): an owner in arrears "is not entitled to vote (either in person,
 *   by ballot or by proxy)" unless the amount in arrears is paid in full —
 *   the s 89B(3) cleared-funds rule is folded into `barredByArrears` upstream.
 * - s 89B(2): despite (1), the owner "may vote on any matter where a special
 *   resolution or a unanimous resolution is required".
 *
 * Related but NOT decided here: s 89C(10) — an owner in arrears must not vote
 * as a PROXY for another lot. That is a standing check on the person casting,
 * enforced by the service.
 */
export function lotMayVote(input: VoterEligibilityInput): boolean {
  if (!input.barredByArrears) return true;
  return input.resolutionType === "special" || input.resolutionType === "unanimous";
}

/**
 * s 77 quorum inputs. A lot is "represented" when its owner (or a valid proxy
 * for it) is present in person or online — the service derives both counts
 * and entitlement sums from the same represented-lot set.
 */
export interface QuorumInput {
  representedLotCount: number;
  totalLotCount: number;
  representedEntitlement: number;
  totalEntitlement: number;
}

/** Which s 77 limb established quorum. */
export type QuorumBasis = "lot_count" | "entitlement";

export interface QuorumResult {
  met: boolean;
  /** The limb that satisfied s 77, or null when quorum is not met. */
  basis: QuorumBasis | null;
}

/**
 * s 77 (as amended by No. 4/2021 s 38): "A quorum for a general meeting is at
 * least 50% of the total number of lots or if 50% of the total number of lots
 * is not available the quorum is at least 50% of the total lot entitlement."
 *
 * The primary basis is the NUMBER of lots represented; only when the
 * lot-count limb is not reached does the entitlement limb apply as fallback.
 */
export function quorumMet(input: QuorumInput): QuorumResult {
  const { representedLotCount, totalLotCount, representedEntitlement, totalEntitlement } = input;
  if (totalLotCount <= 0) throw new Error("voting: totalLotCount must be positive");
  if (totalEntitlement <= 0) throw new Error("voting: totalEntitlement must be positive");
  if (representedLotCount < 0 || representedLotCount > totalLotCount) {
    throw new Error("voting: representedLotCount out of range");
  }
  if (representedEntitlement < 0 || representedEntitlement > totalEntitlement) {
    throw new Error("voting: representedEntitlement out of range");
  }
  if (representedLotCount * 2 >= totalLotCount) return { met: true, basis: "lot_count" };
  if (representedEntitlement * 2 >= totalEntitlement) return { met: true, basis: "entitlement" };
  return { met: false, basis: null };
}
