import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "../src/csv.js";

describe("parseCsv", () => {
  it("parses simple rows and trims cells", () => {
    expect(parseCsv("a, b ,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas, quotes, and newlines", () => {
    expect(parseCsv('"Smith, Jane","say ""hi""","line1\nline2"')).toEqual([
      ["Smith, Jane", 'say "hi"', "line1\nline2"],
    ]);
  });

  it("skips empty lines and handles CRLF", () => {
    expect(parseCsv("a,b\r\n\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvRecords", () => {
  it("keys records by normalized header", () => {
    const records = parseCsvRecords("Lot Number,Entitlement\n1,20");
    expect(records).toEqual([{ lot_number: "1", entitlement: "20" }]);
  });

  it("pads missing trailing cells with empty strings", () => {
    expect(parseCsvRecords("a,b,c\n1,2")).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("returns empty for empty input", () => {
    expect(parseCsvRecords("")).toEqual([]);
  });
});
