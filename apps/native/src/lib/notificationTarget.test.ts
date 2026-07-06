import {
  maintenanceRouteExists,
  resolveNotificationTarget,
  type RoutableNotification,
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
      params: { focus: "levy-7" },
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

  it("work_order → scheme hub today (maintenance route not built), id retained", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "work_order", id: "wo-4" }, category: "maintenance" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}`,
      params: { focus: "wo-4" },
    });
  });

  it("maintenance_request → scheme hub today (maintenance route not built)", () => {
    const target = resolveNotificationTarget(
      notif({
        related: { type: "maintenance_request", id: "req-5" },
        category: "maintenance",
      }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}`,
      params: { focus: "req-5" },
    });
  });

  it("community_post → scheme hub (no community screen on mobile)", () => {
    const target = resolveNotificationTarget(
      notif({ related: { type: "community_post", id: "post-6" }, category: "general" }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}`,
      params: { focus: "post-6" },
    });
  });

  it("compliance_obligation → scheme hub (no compliance screen on mobile)", () => {
    const target = resolveNotificationTarget(
      notif({
        related: { type: "compliance_obligation", id: "ob-1" },
        category: "general",
      }),
    );
    expect(target).toEqual({
      pathname: `/scheme/${SCHEME}`,
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

  it.each(["motion", "vote", "proxy"])(
    "%s → /scheme/[id]/decisions",
    (type) => {
      const target = resolveNotificationTarget(
        notif({ related: { type, id: `${type}-id` }, category: "general" }),
      );
      expect(target).toEqual({
        pathname: `/scheme/${SCHEME}/decisions`,
        params: { focus: `${type}-id` },
      });
    },
  );

  it.each(["budget", "payment", "receipt", "trust_account"])(
    "%s → /scheme/[id]/finance",
    (type) => {
      const target = resolveNotificationTarget(
        notif({ related: { type, id: `${type}-id` }, category: "general" }),
      );
      expect(target).toEqual({
        pathname: `/scheme/${SCHEME}/finance`,
        params: { focus: `${type}-id` },
      });
    },
  );

  it.each(["owner", "committee", "scheme", "breach_notice", "complaint", "message", "minutes"])(
    "%s → scheme hub",
    (type) => {
      const target = resolveNotificationTarget(
        notif({ related: { type, id: `${type}-id` }, category: "general" }),
      );
      expect(target).toEqual({
        pathname: `/scheme/${SCHEME}`,
        params: { focus: `${type}-id` },
      });
    },
  );

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
    const target = resolveNotificationTarget(
      notif({ related: null, category: "finance" }),
    );
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}/finance` });
  });

  it("null related, category general → scheme hub, no params", () => {
    const target = resolveNotificationTarget(
      notif({ related: null, category: "general" }),
    );
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}` });
  });

  it("null related, maintenance category → scheme hub while route is unbuilt", () => {
    const target = resolveNotificationTarget(
      notif({ related: null, category: "maintenance" }),
    );
    expect(target).toEqual({ pathname: `/scheme/${SCHEME}` });
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
  it("is false today, so maintenance types land on the hub (documents the flip point)", () => {
    expect(maintenanceRouteExists).toBe(false);
  });
});
