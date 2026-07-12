import {
  canDecide,
  OFFICER_ROLES,
  schemeQueryOptions,
  useIsOfficer,
  useIsOwnerView,
  useSchemeRoles,
} from "./roles";

// useQuery is stubbed so the role hooks become pure functions of the cached
// data — no React tree, no fetch. Each test seeds the value the hook reads.
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
// Stub ./api so importing roles.ts never pulls in ./auth (better-auth /
// expo-secure-store). We only assert the queryFn delegates to it.
jest.mock("./api", () => ({ api: jest.fn() }));

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

const mockUseQuery = useQuery as unknown as jest.Mock;
const mockApi = api as unknown as jest.Mock;

/** Seed what useSchemeRoles will read from the (mocked) query cache. */
function seedRoles(roles: string[] | undefined) {
  mockUseQuery.mockReturnValue({ data: roles === undefined ? undefined : { roles } });
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockApi.mockReset();
});

describe("canDecide — decider tiers", () => {
  it("manager_admin decides anything, including committee/treasurer tiers", () => {
    expect(canDecide(["manager_admin"], "treasurer")).toBe(true);
    expect(canDecide(["manager_admin"], "committee")).toBe(true);
    expect(canDecide(["manager_admin"], "all_owners")).toBe(true);
    // manager_admin is NOT itself in COMMITTEE_ROLES — the top short-circuit is
    // what carries it, so this guards against a regression to that ordering.
    expect(canDecide(["manager_admin"], "unknown_tier")).toBe(true);
  });

  it("treasurer tier: only a treasurer (or manager_admin) may decide", () => {
    expect(canDecide(["treasurer"], "treasurer")).toBe(true);
    expect(canDecide(["chair"], "treasurer")).toBe(false);
    expect(canDecide(["committee_member"], "treasurer")).toBe(false);
    expect(canDecide([], "treasurer")).toBe(false);
  });

  it("committee tier: any committee-or-officer role may decide", () => {
    expect(canDecide(["committee_member"], "committee")).toBe(true);
    expect(canDecide(["chair"], "committee")).toBe(true);
    expect(canDecide(["secretary"], "committee")).toBe(true);
    expect(canDecide(["treasurer"], "committee")).toBe(true);
    // A plain owner (no committee/officer role) cannot decide a committee tier.
    expect(canDecide(["owner"], "committee")).toBe(false);
    expect(canDecide([], "committee")).toBe(false);
  });

  it("all_owners (and unknown tiers) let every member decide", () => {
    expect(canDecide(["owner"], "all_owners")).toBe(true);
    expect(canDecide([], "all_owners")).toBe(true);
    expect(canDecide(["owner"], "something_new")).toBe(true);
  });
});

describe("schemeQueryOptions", () => {
  it("keys the shared scheme cache and delegates the fetch to api()", () => {
    const options = schemeQueryOptions("s1");
    expect(options.queryKey).toEqual(["scheme", "s1"]);

    options.queryFn();
    expect(mockApi).toHaveBeenCalledWith("/api/schemes/s1");
  });
});

describe("useSchemeRoles", () => {
  it("returns [] while the query is loading (data undefined)", () => {
    seedRoles(undefined);
    expect(useSchemeRoles("s1")).toEqual([]);
  });

  it("returns the roles once the query resolves", () => {
    seedRoles(["chair", "owner"]);
    expect(useSchemeRoles("s1")).toEqual(["chair", "owner"]);
  });
});

describe("useIsOfficer", () => {
  it.each(OFFICER_ROLES)("is true for officer role %s", (role) => {
    seedRoles([role]);
    expect(useIsOfficer("s1")).toBe(true);
  });

  it("is false for a committee member or plain owner", () => {
    seedRoles(["committee_member"]);
    expect(useIsOfficer("s1")).toBe(false);
    seedRoles(["owner"]);
    expect(useIsOfficer("s1")).toBe(false);
  });

  it("is false while loading (no roles yet)", () => {
    seedRoles(undefined);
    expect(useIsOfficer("s1")).toBe(false);
  });
});

describe("useIsOwnerView", () => {
  it("is true for a plain owner (a membership with no officer role)", () => {
    seedRoles(["owner"]);
    expect(useIsOwnerView("s1")).toBe(true);
  });

  it("is false for a committee_member — sitting on the committee gets the full hub", () => {
    seedRoles(["committee_member"]);
    expect(useIsOwnerView("s1")).toBe(false);
    seedRoles(["owner", "committee_member"]);
    expect(useIsOwnerView("s1")).toBe(false);
  });

  it("is false for an officer", () => {
    seedRoles(["treasurer"]);
    expect(useIsOwnerView("s1")).toBe(false);
    seedRoles(["owner", "chair"]);
    expect(useIsOwnerView("s1")).toBe(false);
  });

  it("is false while roles are still loading — never flash the owner layout", () => {
    seedRoles(undefined);
    expect(useIsOwnerView("s1")).toBe(false);
  });
});
