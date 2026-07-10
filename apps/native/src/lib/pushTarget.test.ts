import { pushDataToTarget } from "./pushTarget";

const SCHEME = "scheme-1";

describe("pushDataToTarget — well-formed notifier payloads", () => {
  it("routes a levy push to the finance screen with the entity focused", () => {
    const target = pushDataToTarget({
      schemeId: SCHEME,
      category: "finance",
      related: { type: "levy_notice", id: "levy-7" },
    });
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/finance`,
      params: { focus: "levy-7" },
    });
  });

  it("routes a decision push to the decisions screen", () => {
    const target = pushDataToTarget({
      schemeId: SCHEME,
      category: "decision",
      related: { type: "decision", id: "dec-9" },
    });
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/decisions`,
      params: { focus: "dec-9" },
    });
  });

  it("null related falls back to the category section (meeting → meetings)", () => {
    const target = pushDataToTarget({ schemeId: SCHEME, category: "meeting", related: null });
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}/meetings` });
  });

  it("general + no related lands on the scheme hub", () => {
    const target = pushDataToTarget({ schemeId: SCHEME, category: "general", related: null });
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}` });
  });
});

describe("pushDataToTarget — malformed payloads never route", () => {
  it("rejects non-object data", () => {
    expect(pushDataToTarget(undefined)).toBeNull();
    expect(pushDataToTarget(null)).toBeNull();
    expect(pushDataToTarget("scheme-1")).toBeNull();
    expect(pushDataToTarget(42)).toBeNull();
  });

  it("rejects a missing/empty/non-string schemeId (org compliance sends null)", () => {
    expect(pushDataToTarget({ category: "finance" })).toBeNull();
    expect(pushDataToTarget({ schemeId: "", category: "finance" })).toBeNull();
    expect(pushDataToTarget({ schemeId: null, category: "general" })).toBeNull();
  });

  it("tolerates a malformed related by degrading to the category", () => {
    const target = pushDataToTarget({
      schemeId: SCHEME,
      category: "finance",
      related: { type: 7, id: null },
    });
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}/finance` });
  });

  it("tolerates unknown category strings by degrading to the hub", () => {
    const target = pushDataToTarget({ schemeId: SCHEME, category: "mystery", related: null });
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}` });
  });
});
