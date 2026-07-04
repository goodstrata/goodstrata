import { describe, expect, it } from "vitest";
import { computeEscalation } from "../src/services/compliance.js";
import { isContinuous } from "../src/services/managerRegistration.js";

describe("computeEscalation", () => {
  const asOf = new Date("2026-07-04T00:00:00Z");

  it("maps day gaps onto the escalation bands", () => {
    expect(computeEscalation("2026-07-03", asOf)).toMatchObject({
      escalationState: "overdue",
      status: "overdue",
      daysUntilDue: -1,
    });
    expect(computeEscalation("2026-07-04", asOf)).toMatchObject({
      escalationState: "due",
      status: "due",
      daysUntilDue: 0,
    });
    expect(computeEscalation("2026-07-05", asOf)).toMatchObject({
      escalationState: "t_30",
      status: "upcoming",
      daysUntilDue: 1,
    });
    // Band edges: 30 / 31, 60 / 61, 90 / 91 days out.
    expect(computeEscalation("2026-08-03", asOf).escalationState).toBe("t_30");
    expect(computeEscalation("2026-08-04", asOf).escalationState).toBe("t_60");
    expect(computeEscalation("2026-09-02", asOf).escalationState).toBe("t_60");
    expect(computeEscalation("2026-09-03", asOf).escalationState).toBe("t_90");
    expect(computeEscalation("2026-10-02", asOf).escalationState).toBe("t_90");
    expect(computeEscalation("2026-10-03", asOf)).toMatchObject({
      escalationState: "none",
      status: "upcoming",
      daysUntilDue: 91,
    });
  });

  it("counts whole calendar days regardless of the time of day", () => {
    // 11pm the night before the due date: still "due tomorrow", not "due now".
    const lateNight = new Date("2026-07-03T23:00:00Z");
    expect(computeEscalation("2026-07-04", lateNight)).toMatchObject({
      escalationState: "t_30",
      daysUntilDue: 1,
    });
    // Any time ON the due date reads "due", never "overdue".
    const lateOnDueDay = new Date("2026-07-04T23:59:00Z");
    expect(computeEscalation("2026-07-04", lateOnDueDay)).toMatchObject({
      escalationState: "due",
      daysUntilDue: 0,
    });
    // The 30-day band boundary must not drift with the sweep's run time.
    const morning = new Date("2026-07-04T06:00:00Z");
    const evening = new Date("2026-07-04T21:00:00Z");
    expect(computeEscalation("2026-08-03", morning).escalationState).toBe(
      computeEscalation("2026-08-03", evening).escalationState,
    );
  });
});

describe("isContinuous (PI cover, reg 10)", () => {
  const today = "2026-07-04";

  it("is false with no policy periods", () => {
    expect(isContinuous([], today)).toBe(false);
  });

  it("is true for a single policy still in force", () => {
    expect(isContinuous([{ effectiveOn: "2026-01-01", expiresOn: "2026-12-31" }], today)).toBe(
      true,
    );
  });

  it("is false when the latest cover has already lapsed", () => {
    expect(isContinuous([{ effectiveOn: "2025-01-01", expiresOn: "2026-01-01" }], today)).toBe(
      false,
    );
  });

  it("accepts back-to-back renewals (next starts on or before the day after expiry)", () => {
    expect(
      isContinuous(
        [
          { effectiveOn: "2025-07-01", expiresOn: "2026-06-30" },
          { effectiveOn: "2026-07-01", expiresOn: "2027-06-30" },
        ],
        today,
      ),
    ).toBe(true);
    // Overlap is also fine.
    expect(
      isContinuous(
        [
          { effectiveOn: "2025-07-01", expiresOn: "2026-06-30" },
          { effectiveOn: "2026-06-01", expiresOn: "2027-06-30" },
        ],
        today,
      ),
    ).toBe(true);
  });

  it("is false across a gap between periods", () => {
    expect(
      isContinuous(
        [
          { effectiveOn: "2025-07-01", expiresOn: "2026-06-30" },
          { effectiveOn: "2026-07-03", expiresOn: "2027-06-30" },
        ],
        today,
      ),
    ).toBe(false);
  });

  it("treats a successor with no start date as an unprovable seam", () => {
    expect(
      isContinuous(
        [
          { effectiveOn: "2025-07-01", expiresOn: "2026-06-30" },
          { effectiveOn: null, expiresOn: "2027-06-30" },
        ],
        today,
      ),
    ).toBe(false);
  });
});
