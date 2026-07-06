import {
  MINUS,
  formatDate,
  formatMoney,
  formatMoneyLabel,
  formatRelativeTime,
  humanise,
  plate,
} from "./format";

describe("MINUS", () => {
  it("is the true minus sign U+2212, not an ASCII hyphen", () => {
    expect(MINUS).toBe("−");
    expect(MINUS).not.toBe("-");
  });
});

describe("formatMoney", () => {
  it("splits dollars and cents with thousands separators", () => {
    expect(formatMoney(123456)).toEqual({ dollars: "$1,234", cents: ".56" });
  });

  it("prefixes negatives with the true minus sign", () => {
    const out = formatMoney(-123456);
    expect(out).toEqual({ dollars: `${MINUS}$1,234`, cents: ".56" });
    expect(out.dollars.startsWith(MINUS)).toBe(true);
  });

  it("formats zero as $0.00", () => {
    expect(formatMoney(0)).toEqual({ dollars: "$0", cents: ".00" });
  });

  it("zero-pads cents under ten", () => {
    expect(formatMoney(5)).toEqual({ dollars: "$0", cents: ".05" });
  });

  it("keeps 99 cents under a dollar", () => {
    expect(formatMoney(99)).toEqual({ dollars: "$0", cents: ".99" });
  });

  it("rolls over to one dollar at 100 cents", () => {
    expect(formatMoney(100)).toEqual({ dollars: "$1", cents: ".00" });
  });

  it("groups millions with multiple separators", () => {
    // 123,456,789 cents = $1,234,567.89
    expect(formatMoney(123456789)).toEqual({
      dollars: "$1,234,567",
      cents: ".89",
    });
  });

  it("shows the minus even when the dollar part is zero", () => {
    expect(formatMoney(-5)).toEqual({ dollars: `${MINUS}$0`, cents: ".05" });
  });

  it("rounds non-integer cents to the nearest cent", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatMoney(150.7)).toEqual({ dollars: "$1", cents: ".51" });
    warn.mockRestore();
  });

  it("treats NaN as zero", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatMoney(NaN)).toEqual({ dollars: "$0", cents: ".00" });
    warn.mockRestore();
  });

  it("treats Infinity as zero", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatMoney(Infinity)).toEqual({ dollars: "$0", cents: ".00" });
    warn.mockRestore();
  });
});

describe("formatMoneyLabel", () => {
  it("speaks dollars and cents for accessibility", () => {
    expect(formatMoneyLabel(123456)).toBe("1,234 dollars and 56 cents");
  });

  it("prefixes negatives with the spoken word 'minus'", () => {
    expect(formatMoneyLabel(-123456)).toBe("minus 1,234 dollars and 56 cents");
  });

  it("uses singular 'dollar' for exactly one dollar and no cents", () => {
    expect(formatMoneyLabel(100)).toBe("1 dollar");
  });

  it("uses singular 'cent' for exactly one cent", () => {
    expect(formatMoneyLabel(101)).toBe("1 dollar and 1 cent");
  });

  it("pluralises cents while keeping a singular dollar", () => {
    expect(formatMoneyLabel(102)).toBe("1 dollar and 2 cents");
  });

  it("omits the cents clause when there are no cents", () => {
    expect(formatMoneyLabel(200)).toBe("2 dollars");
  });

  it("says '0 dollars' for zero", () => {
    expect(formatMoneyLabel(0)).toBe("0 dollars");
  });

  it("reports cents when there are no whole dollars", () => {
    expect(formatMoneyLabel(5)).toBe("0 dollars and 5 cents");
  });
});

describe("humanise", () => {
  it("turns a snake_case enum into a sentence", () => {
    expect(humanise("final_notice")).toBe("Final notice");
  });

  it("handles kebab-case too", () => {
    expect(humanise("first-notice")).toBe("First notice");
  });

  it("collapses runs of separators into single spaces", () => {
    expect(humanise("a__b--c")).toBe("A b c");
  });

  it("trims surrounding separators", () => {
    expect(humanise("_active_")).toBe("Active");
  });

  it("leaves an already-capitalised word unchanged", () => {
    expect(humanise("Paid")).toBe("Paid");
  });

  it("capitalises a single character", () => {
    expect(humanise("x")).toBe("X");
  });

  it("returns the original for an empty string", () => {
    expect(humanise("")).toBe("");
  });

  it("returns the original when the value is only separators", () => {
    expect(humanise("__")).toBe("__");
  });
});

describe("plate", () => {
  it("returns undefined when the scheme is undefined", () => {
    expect(plate(undefined)).toBeUndefined();
  });

  it("returns undefined when there is no plan of subdivision", () => {
    expect(plate({ planOfSubdivision: null })).toBeUndefined();
  });

  it("returns undefined for an empty plan string", () => {
    expect(plate({ planOfSubdivision: "" })).toBeUndefined();
  });

  it("joins plan and tier with the middot separator", () => {
    expect(plate({ planOfSubdivision: "PS 543921K", tier: 2 })).toBe(
      "PS 543921K · Tier 2",
    );
  });

  it("strips non-digits from a stringy tier", () => {
    expect(plate({ planOfSubdivision: "PS 543921K", tier: "T2" })).toBe(
      "PS 543921K · Tier 2",
    );
  });

  it("shows only the plan when tier is null", () => {
    expect(plate({ planOfSubdivision: "PS 543921K", tier: null })).toBe(
      "PS 543921K",
    );
  });

  it("shows only the plan when tier is omitted", () => {
    expect(plate({ planOfSubdivision: "PS 543921K" })).toBe("PS 543921K");
  });

  it("shows only the plan when tier has no digits", () => {
    expect(plate({ planOfSubdivision: "PS 543921K", tier: "none" })).toBe(
      "PS 543921K",
    );
  });

  it("treats tier 0 as a real tier, not as missing", () => {
    expect(plate({ planOfSubdivision: "PS 543921K", tier: 0 })).toBe(
      "PS 543921K · Tier 0",
    );
  });
});

describe("formatDate", () => {
  it("formats a Date as 'D Mon YYYY'", () => {
    expect(formatDate(new Date(2026, 2, 12))).toBe("12 Mar 2026");
  });

  it("does not zero-pad the day", () => {
    expect(formatDate(new Date(2026, 0, 1))).toBe("1 Jan 2026");
  });

  it("formats December correctly (last month index)", () => {
    expect(formatDate(new Date(2026, 11, 25))).toBe("25 Dec 2026");
  });

  it("accepts a millisecond timestamp", () => {
    const ms = new Date(2026, 2, 12).getTime();
    expect(formatDate(ms)).toBe("12 Mar 2026");
  });

  it("returns an empty string for an unparseable date string", () => {
    expect(formatDate("not a date")).toBe("");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatDate("")).toBe("");
  });

  it("returns an empty string for NaN", () => {
    expect(formatDate(NaN)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it("says 'now' for the current instant", () => {
    expect(formatRelativeTime(now, now)).toBe("now");
  });

  it("says 'now' for anything under a minute ago", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("now");
  });

  it("counts whole minutes", () => {
    expect(formatRelativeTime(now - 5 * minute, now)).toBe("5 min");
  });

  it("still uses minutes at 59 minutes", () => {
    expect(formatRelativeTime(now - 59 * minute, now)).toBe("59 min");
  });

  it("switches to hours at 60 minutes", () => {
    expect(formatRelativeTime(now - hour, now)).toBe("1 h");
  });

  it("counts hours up to 23", () => {
    expect(formatRelativeTime(now - 23 * hour, now)).toBe("23 h");
  });

  it("switches to days at 24 hours", () => {
    expect(formatRelativeTime(now - day, now)).toBe("1 d");
  });

  it("counts days up to 6", () => {
    expect(formatRelativeTime(now - 6 * day, now)).toBe("6 d");
  });

  it("falls back to an absolute date at 7 days and beyond", () => {
    const then = now - 10 * day;
    expect(formatRelativeTime(then, now)).toBe(formatDate(new Date(then)));
  });

  it("clamps future timestamps to 'now'", () => {
    expect(formatRelativeTime(now + hour, now)).toBe("now");
  });

  it("returns an empty string for an invalid input", () => {
    expect(formatRelativeTime("not a date", now)).toBe("");
  });

  it("defaults the reference point to the present", () => {
    expect(formatRelativeTime(Date.now())).toBe("now");
  });
});
