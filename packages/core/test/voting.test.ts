import { describe, expect, it } from "vitest";
import { quorumMet, tallyMotion } from "../src/engines/voting.js";

const vote = (lotId: string, choice: "for" | "against" | "abstain", weight: number) => ({
  lotId,
  choice,
  entitlementWeight: weight,
});

describe("tallyMotion — ordinary resolutions (one vote per lot, s 91/s 92)", () => {
  it("carries on a simple majority of lots voting, regardless of weight", () => {
    const t = tallyMotion([vote("a", "for", 20), vote("b", "against", 10)], 130, "ordinary");
    // One vote each → 1 for vs 1 against → tie → lost, even though for-weight is larger.
    expect(t.carried).toBe(false);
    expect(t.basis).toBe("headcount");
    expect(t.forCount).toBe(1);
    expect(t.againstCount).toBe(1);
  });

  it("headcount beats weight by default (no poll demanded)", () => {
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

  it("a majority of lots carries it", () => {
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

describe("tallyMotion — ordinary resolutions with a poll demanded (s 92(3)–(5))", () => {
  // Same roll: lot-count majority DIFFERS from entitlement majority.
  const roll = [vote("a", "for", 20), vote("b", "against", 9), vote("c", "against", 9)];

  it("one-vote-per-lot decides it by default", () => {
    const t = tallyMotion(roll, 130, "ordinary");
    expect(t.carried).toBe(false);
    expect(t.basis).toBe("headcount");
    expect(t.pollDemanded).toBe(false);
  });

  it("entitlement decides it when a poll is demanded", () => {
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
});

describe("tallyMotion — special resolutions (75% of TOTAL entitlement)", () => {
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

describe("tallyMotion — unanimous", () => {
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

describe("quorumMet", () => {
  it("half the entitlements is exactly quorate", () => {
    expect(quorumMet(65, 130)).toBe(true);
    expect(quorumMet(64, 130)).toBe(false);
    expect(quorumMet(0, 130)).toBe(false);
    expect(quorumMet(130, 130)).toBe(true);
  });
});
