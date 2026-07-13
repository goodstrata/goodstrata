import { describe, expect, it } from "vitest";
import { defaultRetentionClass } from "../src/services/documents.js";
import {
  addBusinessDays,
  certificateMaximumFeeCents,
  inspectionMaximumCopyFeeCents,
} from "../src/services/records.js";

describe("Victorian records statutory helpers", () => {
  it("calculates the versioned 2026-27 certificate fee caps", () => {
    expect(certificateMaximumFeeCents("standard_6_10_days")).toBe(16_648);
    expect(certificateMaximumFeeCents("priority_3_5_days")).toBe(24_972);
    expect(certificateMaximumFeeCents("urgent_2_days")).toBe(29_963);
    expect(certificateMaximumFeeCents("standard_6_10_days", true)).toBe(9_153);
  });

  it("caps register and record copies separately and adds printed pages", () => {
    expect(inspectionMaximumCopyFeeCents({ scope: "register", recordCount: 0 })).toBe(5_233);
    expect(inspectionMaximumCopyFeeCents({ scope: "records", recordCount: 3 })).toBe(3_506);
    expect(inspectionMaximumCopyFeeCents({ scope: "both", recordCount: 3, printedPages: 10 })).toBe(
      8_939,
    );
  });

  it("skips weekends and injected Victorian public holidays for service deadlines", () => {
    const friday = new Date("2026-12-18T02:00:00.000Z");
    expect(addBusinessDays(friday, 2).toISOString()).toBe("2026-12-22T02:00:00.000Z");
    expect(addBusinessDays(friday, 2, ["2026-12-21"]).toISOString()).toBe(
      "2026-12-23T02:00:00.000Z",
    );
  });

  it("makes building-life records permanent and statutory filing classes explicit", () => {
    expect(defaultRetentionClass("plan_of_subdivision")).toBe("permanent");
    expect(defaultRetentionClass("minutes")).toBe("statutory_7_years");
    expect(defaultRetentionClass("financial")).toBe("statutory_7_years");
    expect(defaultRetentionClass("other")).toBe("operational");
  });
});
