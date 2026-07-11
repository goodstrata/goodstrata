import {
  maintenanceRouteExists,
  type RoutableNotification,
  resolveNotificationTarget,
} from "./notificationTarget";

const SCHEME = "scheme-1";

/** Build a notification with sensible defaults for the fields under test. */
function notif(over: Partial<RoutableNotification> = {}): RoutableNotification {
  return { schemeId: SCHEME, related: null, category: "general", ...over };
}

describe("resolveNotificationTarget — emitted related.type families", () => {
  it("decision → /scheme/[id]/decisions, entity id in params.focus", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "decision", id: "dec-9" }, category: "decision" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/decisions`,
      params: { focus: "dec-9" },
    });
  });

  it("meeting → /scheme/[id]/meetings (also the minutes.drafted anchor)", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "meeting", id: "mtg-3" }, category: "meeting" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/meetings`,
      params: { focus: "mtg-3" },
    });
  });

  it("levy_notice → /scheme/[id]/finance", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "levy_notice", id: "levy-7" }, category: "finance" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/finance`,
      params: { focus: "levy-7", focusType: "levy_notice" },
    });
  });

  it("lot (arrears) → /scheme/[id]/finance, not the hub", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "lot", id: "lot-2" }, category: "finance" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/finance`,
      params: { focus: "lot-2" },
    });
  });

  it("work_order → maintenance, id retained", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "work_order", id: "wo-4" }, category: "maintenance" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/maintenance`,
      params: { focus: "wo-4" },
    });
  });

  it("maintenance_request → maintenance", () => {
    const target = resolveNotificationTarget(
      notif({
        related: { type: "maintenance_request", id: "req-5" },
        category: "maintenance",
      }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/maintenance`,
      params: { focus: "req-5" },
    });
  });

  it("community_post → community", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "community_post", id: "post-6" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/community`,
      params: { focus: "post-6", focusType: "community_post" },
    });
  });

  it("announcement → community, preserving the post focus anchor", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "announcement", id: "announcement-7" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/community`,
      params: { focus: "announcement-7", focusType: "announcement" },
    });
  });

  it("conversation → community inbox, preserving its private thread anchor", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "conversation", id: "conversation-8" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/community`,
      params: { focus: "conversation-8", focusType: "conversation" },
    });
  });

  it("compliance_obligation → compliance", () => {
    const target = resolveNotificationTarget(
      notif({
        related: { type: "compliance_obligation", id: "ob-1" },
        category: "general",
      }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/compliance`,
      params: { focus: "ob-1" },
    });
  });
});

describe("resolveNotificationTarget — forward-compat families (not emitted yet)", () => {
  it("document.* → /scheme/[id]/documents", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "document", id: "doc-1" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/documents`,
      params: { focus: "doc-1" },
    });
  });

  it("vote → /scheme/[id]/decisions", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "vote", id: "vote-id" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/decisions`,
      params: { focus: "vote-id" },
    });
  });

  it.each(["motion", "proxy"])("%s → /scheme/[id]/meetings", (type) => {
    const target = resolveNotificationTarget(
      notif({ related: { type, id: `${type}-id` }, category: "meeting" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/meetings`,
      params: { focus: `${type}-id` },
    });
  });

  it("payment → finance with an explicit payment focus", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "payment", id: "payment-id" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/finance`,
      params: { focus: "payment-id", focusType: "payment" },
    });
  });

  it.each(["budget", "receipt", "trust_account"])("%s → /scheme/[id]/finance", (type) => {
    const target = resolveNotificationTarget(
      notif({ related: { type, id: `${type}-id` }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/finance`,
      params: { focus: `${type}-id` },
    });
  });

  it.each(["owner", "committee", "scheme", "message", "minutes"])("%s → scheme hub", (type) => {
    const target = resolveNotificationTarget(
      notif({ related: { type, id: `${type}-id` }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}`,
      params: { focus: `${type}-id` },
    });
  });

  it.each([
    ["complaint", "grievances"],
    ["breach_notice", "grievances"],
  ])("%s → %s", (type, section) => {
    expect(
      resolveNotificationTarget(notif({ related: { type, id: "entity-1" }, category: "general" })),
    ).toEqual({
      pathname: `/scheme/${SCHEME}/${section}`,
      params: { focus: "entity-1" },
    });
  });

  it("resolves a dotted event-style type by its prefix (document.uploaded)", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "document.uploaded", id: "doc-2" } }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/documents`,
      params: { focus: "doc-2" },
    });
  });
});

describe("resolveNotificationTarget — fallbacks", () => {
  it("null related → falls back to category (finance)", () => {
    const target = resolveNotificationTarget(notif({ related: null, category: "finance" }));
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}/finance` });
  });

  it("null related, category general → scheme hub, no params", () => {
    const target = resolveNotificationTarget(notif({ related: null, category: "general" }));
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}` });
  });

  it("null related, maintenance category → maintenance", () => {
    const target = resolveNotificationTarget(notif({ related: null, category: "maintenance" }));
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}/maintenance` });
  });

  it("unknown related.type falls back to category, keeping the entity id", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "totally_new_thing", id: "x-1" }, category: "meeting" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}/meetings`,
      params: { focus: "x-1" },
    });
  });

  it("unknown related.type and unknown category → scheme hub", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "mystery", id: "m-1" }, category: "not_a_category" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}`,
      params: { focus: "m-1" },
    });
  });

  it("returns null when there is no scheme to route to", () => {
    expect(resolveNotificationTarget(notif({ schemeId: "" }))).toBeNull();
  });

  it("omits params when there is no entity id (related null)", () => {
    const target = resolveNotificationTarget(notif({ related: null, category: "decision" }));
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}/decisions` });
    expect(target).not.toHaveProperty("params");
  });
});

describe("maintenanceRouteExists flag", () => {
  it("is true because maintenance has a live native route", () => {
    expect(maintenanceRouteExists).toBe(true);
  });
});
