import { describe, expect, it } from "vitest";
import { lotMayVote, quorumMet, retallyOnPoll, tallyMotion } from "../src/engines/voting.js";

const vote = (lotId: string, choice: "for" | "against" | "abstain", weight: number) => ({
  lotId,
  choice,
  entitlementWeight: weight,
});

describe("tallyMotion — ordinary resolutions (one vote per lot, s 87/s 89(2))", () => {
  it("s 89(2): carries on a simple majority of lots voting, regardless of weight", () => {
    const t = tallyMotion([vote("a", "for", 20), vote("b", "against", 10)], 130, "ordinary");
    // One vote each → 1 for vs 1 against → tie → lost, even though for-weight is larger.
    expect(t.carried).toBe(false);
    expect(t.basis).toBe("headcount");
    expect(t.forCount).toBe(1);
    expect(t.againstCount).toBe(1);
  });

  it("s 87: headcount beats weight by default (no poll demanded)", () => {
    // Two small lots against, one big lot for: entitlement would carry, headcount defeats it.
    const t = tallyMotion(
      [vote("a", "for", 20), vote("b", "against", 9), vote("c", "against", 9)],
      130,
      "ordinary",
    );
    expect(t.carried).toBe(false);
    expect(t.basis).toBe("headcount");
    expect(t.forCount).toBe(1);
    expect(t.againstCount).toBe(2);
  });

  it("s 89(2): a majority of lots carries it", () => {
    const t = tallyMotion(
      [vote("a", "for", 5), vote("b", "for", 5), vote("c", "against", 100)],
      130,
      "ordinary",
    );
    expect(t.carried).toBe(true);
    expect(t.basis).toBe("headcount");
  });

  it("a tie is lost", () => {
    const t = tallyMotion([vote("a", "for", 10), vote("b", "against", 10)], 130, "ordinary");
    expect(t.carried).toBe(false);
  });

  it("abstentions don't count as votes cast", () => {
    // 1 for, 1 against, 1 abstain → for is not > against → lost.
    const t = tallyMotion(
      [vote("a", "for", 10), vote("b", "against", 9), vote("c", "abstain", 50)],
      130,
      "ordinary",
    );
    expect(t.carried).toBe(false);
    expect(t.abstainCount).toBe(1);
  });

  it("no votes for → lost", () => {
    const t = tallyMotion([vote("a", "abstain", 10)], 130, "ordinary");
    expect(t.carried).toBe(false);
  });
});

describe("tallyMotion — ordinary resolutions with a poll demanded (s 89(3)–(5))", () => {
  // Same roll: lot-count majority DIFFERS from entitlement majority.
  const roll = [vote("a", "for", 20), vote("b", "against", 9), vote("c", "against", 9)];

  it("one-vote-per-lot decides it by default", () => {
    const t = tallyMotion(roll, 130, "ordinary");
    expect(t.carried).toBe(false);
    expect(t.basis).toBe("headcount");
    expect(t.pollDemanded).toBe(false);
  });

  it("s 89(3): entitlement decides it when a poll is demanded", () => {
    const t = tallyMotion(roll, 130, "ordinary", true);
    // 20 for vs 18 against → carried on entitlement weight.
    expect(t.carried).toBe(true);
    expect(t.basis).toBe("entitlement");
    expect(t.pollDemanded).toBe(true);
    expect(t.forWeight).toBe(20);
    expect(t.againstWeight).toBe(18);
  });

  it("a poll can defeat a motion the headcount would carry", () => {
    // Two small lots for, one big lot against: headcount carries, poll defeats.
    const split = [vote("a", "for", 5), vote("b", "for", 5), vote("c", "against", 100)];
    expect(tallyMotion(split, 130, "ordinary").carried).toBe(true);
    expect(tallyMotion(split, 130, "ordinary", true).carried).toBe(false);
  });

  it("s 89(5): a post-vote poll displaces a CARRIED show-of-hands result", () => {
    // Two small lots for, one big lot against: declared carried on the show
    // of hands. A poll demanded after the vote is taken re-decides the same
    // votes on entitlement — the earlier decision "has no effect".
    const split = [vote("a", "for", 5), vote("b", "for", 5), vote("c", "against", 100)];
    const declared = tallyMotion(split, 130, "ordinary");
    expect(declared.carried).toBe(true);
    expect(declared.basis).toBe("headcount");

    const poll = retallyOnPoll(split, 130);
    expect(poll.carried).toBe(false);
    expect(poll.basis).toBe("entitlement");
    expect(poll.pollDemanded).toBe(true);
    expect(poll.resolutionType).toBe("ordinary");
  });

  it("s 89(5): recount is a pure function of the same votes — identical to a pre-vote poll", () => {
    expect(retallyOnPoll(roll, 130)).toEqual(tallyMotion(roll, 130, "ordinary", true));
  });

  it("s 89(3): a poll on a special resolution is rejected", () => {
    expect(() => tallyMotion([vote("a", "for", 100)], 130, "special", true)).toThrow(
      /ordinary resolution \(s 89\(3\)\)/,
    );
  });

  it("s 89(3): a poll on a unanimous resolution is rejected", () => {
    expect(() => tallyMotion([vote("a", "for", 130)], 130, "unanimous", true)).toThrow(
      /ordinary resolution \(s 89\(3\)\)/,
    );
  });
});

describe("tallyMotion — special resolutions (s 96: 75% of TOTAL entitlement)", () => {
  it("exactly 75% carries", () => {
    const t = tallyMotion([vote("a", "for", 75), vote("b", "against", 25)], 100, "special");
    expect(t.carried).toBe(true);
  });

  it("just under 75% is lost even if unopposed", () => {
    const t = tallyMotion([vote("a", "for", 74)], 100, "special");
    expect(t.carried).toBe(false);
  });

  it("non-voters count against reaching 75%", () => {
    // 80 of 130 entitlement votes for — 61.5% of total — lost.
    const t = tallyMotion([vote("a", "for", 80)], 130, "special");
    expect(t.carried).toBe(false);
  });
});

describe("tallyMotion — unanimous (s 95)", () => {
  it("requires every entitlement in favour", () => {
    expect(tallyMotion([vote("a", "for", 130)], 130, "unanimous").carried).toBe(true);
    expect(
      tallyMotion([vote("a", "for", 129), vote("b", "abstain", 1)], 130, "unanimous").carried,
    ).toBe(false);
  });
});

describe("tallyMotion — integrity", () => {
  it("rejects duplicate lot votes", () => {
    expect(() =>
      tallyMotion([vote("a", "for", 10), vote("a", "against", 10)], 130, "ordinary"),
    ).toThrow(/duplicate/);
  });

  it("rejects cast weight exceeding the roll", () => {
    expect(() => tallyMotion([vote("a", "for", 200)], 130, "ordinary")).toThrow(/exceeds/);
  });

  it("rejects nonpositive weights and rolls", () => {
    expect(() => tallyMotion([vote("a", "for", 0)], 130, "ordinary")).toThrow();
    expect(() => tallyMotion([], 0, "ordinary")).toThrow();
  });
});

describe("lotMayVote — s 89B arrears bar", () => {
  it("s 89B(1): a lot barred by arrears cannot vote on an ordinary resolution", () => {
    expect(lotMayVote({ resolutionType: "ordinary", barredByArrears: true })).toBe(false);
  });

  it("s 89B(2): the bar does not apply to special or unanimous resolutions", () => {
    expect(lotMayVote({ resolutionType: "special", barredByArrears: true })).toBe(true);
    expect(lotMayVote({ resolutionType: "unanimous", barredByArrears: true })).toBe(true);
  });

  it("s 89B(3): an unbarred lot (arrears paid in cleared funds upstream) may vote", () => {
    expect(lotMayVote({ resolutionType: "ordinary", barredByArrears: false })).toBe(true);
    expect(lotMayVote({ resolutionType: "special", barredByArrears: false })).toBe(true);
    expect(lotMayVote({ resolutionType: "unanimous", barredByArrears: false })).toBe(true);
  });
});

describe("quorumMet — s 77 (lot count primary, entitlement fallback)", () => {
  it("s 77: quorum met by lot count even when entitlement falls short", () => {
    // 2 of 4 lots present, but they hold only 20 of 130 entitlement.
    const q = quorumMet({
      representedLotCount: 2,
      totalLotCount: 4,
      representedEntitlement: 20,
      totalEntitlement: 130,
    });
    expect(q.met).toBe(true);
    expect(q.basis).toBe("lot_count");
  });

  it("s 77: entitlement limb saves an under-count meeting (fallback)", () => {
    // 1 of 4 lots present, but that lot holds 100 of 130 entitlement.
    const q = quorumMet({
      representedLotCount: 1,
      totalLotCount: 4,
      representedEntitlement: 100,
      totalEntitlement: 130,
    });
    expect(q.met).toBe(true);
    expect(q.basis).toBe("entitlement");
  });

  it("s 77: lot count is the PRIMARY basis when both limbs are satisfied", () => {
    const q = quorumMet({
      representedLotCount: 3,
      totalLotCount: 4,
      representedEntitlement: 100,
      totalEntitlement: 130,
    });
    expect(q.met).toBe(true);
    expect(q.basis).toBe("lot_count");
  });

  it("s 77: neither limb reached → no quorum", () => {
    const q = quorumMet({
      representedLotCount: 1,
      totalLotCount: 4,
      representedEntitlement: 20,
      totalEntitlement: 130,
    });
    expect(q.met).toBe(false);
    expect(q.basis).toBe(null);
  });

  it("s 77: exactly 50% of the number of lots is quorate", () => {
    expect(
      quorumMet({
        representedLotCount: 2,
        totalLotCount: 4,
        representedEntitlement: 0,
        totalEntitlement: 130,
      }).met,
    ).toBe(true);
    expect(
      quorumMet({
        representedLotCount: 1,
        totalLotCount: 3,
        representedEntitlement: 0,
        totalEntitlement: 130,
      }).met,
    ).toBe(false);
  });

  it("s 77: exactly 50% of total entitlement is quorate on the fallback limb", () => {
    const at = quorumMet({
      representedLotCount: 1,
      totalLotCount: 4,
      representedEntitlement: 65,
      totalEntitlement: 130,
    });
    expect(at.met).toBe(true);
    expect(at.basis).toBe("entitlement");
    const under = quorumMet({
      representedLotCount: 1,
      totalLotCount: 4,
      representedEntitlement: 64,
      totalEntitlement: 130,
    });
    expect(under.met).toBe(false);
  });

  it("empty meeting is not quorate", () => {
    const q = quorumMet({
      representedLotCount: 0,
      totalLotCount: 4,
      representedEntitlement: 0,
      totalEntitlement: 130,
    });
    expect(q.met).toBe(false);
  });

  it("rejects impossible inputs", () => {
    expect(() =>
      quorumMet({
        representedLotCount: 0,
        totalLotCount: 0,
        representedEntitlement: 0,
        totalEntitlement: 130,
      }),
    ).toThrow(/totalLotCount/);
    expect(() =>
      quorumMet({
        representedLotCount: 0,
        totalLotCount: 4,
        representedEntitlement: 0,
        totalEntitlement: 0,
      }),
    ).toThrow(/totalEntitlement/);
    expect(() =>
      quorumMet({
        representedLotCount: 5,
        totalLotCount: 4,
        representedEntitlement: 0,
        totalEntitlement: 130,
      }),
    ).toThrow(/representedLotCount/);
    expect(() =>
      quorumMet({
        representedLotCount: 1,
        totalLotCount: 4,
        representedEntitlement: 200,
        totalEntitlement: 130,
      }),
    ).toThrow(/representedEntitlement/);
  });
});
