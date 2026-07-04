import { describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import {
  BREACH_NOTICE_OUTCOMES,
  closeBreachNoticeInput,
  listMyComplaints,
  s159WindowBounds,
} from "../src/services/grievances.js";

describe("closeBreachNoticeInput", () => {
  it("accepts each closing outcome", () => {
    for (const status of BREACH_NOTICE_OUTCOMES) {
      expect(closeBreachNoticeInput.parse({ status })).toEqual({ status });
    }
  });

  it("rejects re-issuing or unknown statuses", () => {
    expect(closeBreachNoticeInput.safeParse({ status: "issued" }).success).toBe(false);
    expect(closeBreachNoticeInput.safeParse({ status: "open" }).success).toBe(false);
    expect(closeBreachNoticeInput.safeParse({}).success).toBe(false);
  });
});

describe("listMyComplaints", () => {
  it("returns nothing for a non-user actor without touching the db", async () => {
    const ctx = { actor: { kind: "agent", id: "conductor" } } as unknown as ServiceContext;
    await expect(listMyComplaints(ctx, "scheme-1")).resolves.toEqual([]);
  });
});

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
