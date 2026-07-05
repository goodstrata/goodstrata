import { describe, expect, it } from "vitest";
import {
  csvCell,
  csvRow,
  onOrBefore,
  withinBounds,
} from "../src/services/trustReconciliation.js";

/**
 * Direct, DB-free boundary tests for the pure helpers behind the auditor-facing
 * trust-reconciliation artefacts:
 *  - csvCell/csvRow: the RFC-4180 escaping the audit CSV depends on (a scheme
 *    name with a comma or newline must not misalign the pack);
 *  - withinBounds/onOrBefore: the exact date-window edges that decide which
 *    fund transactions land in the opening balance vs. the reporting window.
 */

describe("csvCell — RFC-4180 escaping", () => {
  it("leaves a plain value untouched", () => {
    expect(csvCell("Fitzroy")).toBe("Fitzroy");
    expect(csvCell(12345)).toBe("12345");
    expect(csvCell("")).toBe("");
  });

  it("quotes a value containing a comma", () => {
    // Routine real scheme name — must stay a single field.
    expect(csvCell("The Owners — Plan No. 12, Fitzroy")).toBe(
      '"The Owners — Plan No. 12, Fitzroy"',
    );
  });

  it("doubles an embedded double-quote and wraps the cell", () => {
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
  });

  it("wraps a value containing CR and/or LF newlines", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvCell("line1\rline2")).toBe('"line1\rline2"');
  });

  it("does NOT neutralise a leading =, +, -, or @ (CSV-injection gap, pinned)", () => {
    // KNOWN LATENT RISK: a formula-like value flows through unquoted and
    // un-prefixed, so an attacker-controlled scheme/fund name like "=cmd()"
    // becomes a live formula in the auditor's Excel/Sheets. This test documents
    // current behaviour — it is NOT an endorsement. If csvCell later gains
    // formula-injection neutralisation (e.g. a leading apostrophe / tab), THIS
    // assertion should be updated to demand it.
    expect(csvCell("=cmd()")).toBe("=cmd()");
    expect(csvCell("+1+1")).toBe("+1+1");
    expect(csvCell("-2+3")).toBe("-2+3");
    expect(csvCell("@SUM(A1:A9)")).toBe("@SUM(A1:A9)");
    // A formula value that ALSO contains a comma is quoted (for RFC-4180
    // reasons) but the injection payload survives intact.
    expect(csvCell("=HYPERLINK(1,2)")).toBe('"=HYPERLINK(1,2)"');
  });
});

describe("csvRow", () => {
  it("joins escaped cells with commas", () => {
    expect(csvRow(["Owners corporation", "The Owners — Plan No. 12, Fitzroy"])).toBe(
      'Owners corporation,"The Owners — Plan No. 12, Fitzroy"',
    );
  });

  it("emits an empty string for an empty row", () => {
    expect(csvRow([])).toBe("");
  });
});

describe("withinBounds — reporting-window edges", () => {
  const from = "2026-03-01";
  const to = "2026-03-31";
  const at = (isoDay: string) => new Date(`${isoDay}T00:00:00.000Z`);

  it("includes a transaction dated exactly on `from` (in-window, not opening)", () => {
    expect(withinBounds(at("2026-03-01"), from, to)).toBe(true);
  });

  it("includes a transaction dated exactly on `to`", () => {
    expect(withinBounds(at("2026-03-31"), from, to)).toBe(true);
  });

  it("excludes the day before `from` (belongs to opening balance)", () => {
    expect(withinBounds(at("2026-02-28"), from, to)).toBe(false);
  });

  it("excludes the day after `to`", () => {
    expect(withinBounds(at("2026-04-01"), from, to)).toBe(false);
  });

  it("is time-of-day agnostic — a late-night `to` transaction still counts", () => {
    expect(withinBounds(new Date("2026-03-31T23:59:59.999Z"), from, to)).toBe(true);
  });

  it("open-ended bounds include everything", () => {
    expect(withinBounds(at("1999-01-01"), undefined, undefined)).toBe(true);
    expect(withinBounds(at("2026-02-28"), undefined, to)).toBe(true); // only `to` bounds
    expect(withinBounds(at("2026-04-01"), from, undefined)).toBe(true); // only `from` bounds
  });
});

describe("onOrBefore — bank-balance cutoff edge", () => {
  const to = "2026-03-31";
  const at = (isoDay: string) => new Date(`${isoDay}T00:00:00.000Z`);

  it("includes a movement dated exactly on `to`", () => {
    expect(onOrBefore(at("2026-03-31"), to)).toBe(true);
  });

  it("excludes a movement after `to`", () => {
    expect(onOrBefore(at("2026-04-01"), to)).toBe(false);
  });

  it("treats an open (undefined) `to` as unbounded — everything is on/before", () => {
    expect(onOrBefore(at("2999-12-31"), undefined)).toBe(true);
  });
});
