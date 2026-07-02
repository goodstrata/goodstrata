import { describe, expect, it } from "vitest";
import { quorumMet, tallyMotion } from "../src/engines/voting.js";

const vote = (lotId: string, choice: "for" | "against" | "abstain", weight: number) => ({
  lotId,
  choice,
  entitlementWeight: weight,
});

describe("tallyMotion — ordinary resolutions", () => {
  it("carries on a weighted majority of votes cast", () => {
    const t = tallyMotion([vote("a", "for", 20), vote("b", "against", 10)], 130, "ordinary");
    expect(t.carried).toBe(true);
    expect(t.forWeight).toBe(20);
  });

  it("weight beats headcount", () => {
    // Two small lots against, one big lot for.
    const t = tallyMotion(
      [vote("a", "for", 20), vote("b", "against", 9), vote("c", "against", 9)],
      130,
      "ordinary",
    );
    expect(t.carried).toBe(true);
  });

  it("a tie is lost", () => {
    const t = tallyMotion([vote("a", "for", 10), vote("b", "against", 10)], 130, "ordinary");
    expect(t.carried).toBe(false);
  });

  it("abstentions don't help either side", () => {
    const t = tallyMotion(
      [vote("a", "for", 10), vote("b", "against", 9), vote("c", "abstain", 50)],
      130,
      "ordinary",
    );
    expect(t.carried).toBe(true);
  });

  it("no votes for → lost", () => {
    const t = tallyMotion([vote("a", "abstain", 10)], 130, "ordinary");
    expect(t.carried).toBe(false);
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
