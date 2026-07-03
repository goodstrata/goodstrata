import { describe, expect, it } from "vitest";
import { s159WindowBounds } from "../src/services/grievances.js";

describe("s159WindowBounds", () => {
  it("extends a date-only `to` bound to the END of that calendar day", () => {
    const { toMs } = s159WindowBounds({ to: "2026-06-30" });
    // Inclusive: an event at 23:59:59.999 UTC on the last day is still <= toMs…
    const lastMoment = new Date("2026-06-30T23:59:59.999Z").getTime();
    expect(toMs).toBe(lastMoment);
    expect(lastMoment > toMs!).toBe(false);
    // …and an event just after midnight, which the old midnight bound dropped,
    // is now correctly inside the window.
    const afterMidnight = new Date("2026-06-30T00:00:01Z").getTime();
    expect(afterMidnight > toMs!).toBe(false);
    // The first instant of the next day is outside.
    const nextDay = new Date("2026-07-01T00:00:00Z").getTime();
    expect(nextDay > toMs!).toBe(true);
  });

  it("leaves an explicit timestamp `to` bound untouched", () => {
    const iso = "2026-06-30T12:00:00Z";
    const { toMs } = s159WindowBounds({ to: iso });
    expect(toMs).toBe(new Date(iso).getTime());
  });

  it("uses the raw `from` bound and nulls when unset", () => {
    const { fromMs, toMs } = s159WindowBounds({ from: "2026-01-01" });
    expect(fromMs).toBe(new Date("2026-01-01").getTime());
    expect(toMs).toBeNull();
    expect(s159WindowBounds()).toEqual({ fromMs: null, toMs: null });
  });
});
