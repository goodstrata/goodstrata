import { cleanup, render, screen } from "@testing-library/react-native";
import SchemeHub from "../app/scheme/[id]/index";

// Drive the role gate from the mocked query cache — no fetch, no auth. useQuery
// is stubbed and answered by queryKey so the hub's detail/overview queries AND
// the roles hooks (which subscribe to the same ["scheme", id] key) all read the
// value each test seeds.
jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueries: () => [],
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// Stub ./api so importing the hub (and roles.ts) never pulls in ./auth
// (better-auth / expo-secure-store). The queryFns never run — useQuery is mocked.
jest.mock("../src/lib/api", () => ({ api: jest.fn() }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
  useLocalSearchParams: () => ({ id: "s1" }),
}));

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SafeAreaView: ({
      children,
      ...p
    }: { children?: import("react").ReactNode } & Record<string, unknown>) =>
      React.createElement(View, p, children),
    SafeAreaProvider: ({ children }: { children?: import("react").ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import { useQuery } from "@tanstack/react-query";

const mockUseQuery = useQuery as unknown as jest.Mock;

const overviewData = {
  scheme: {
    id: "s1",
    name: "Marina Views",
    planOfSubdivision: "PS 543921K",
    tier: 2,
    status: "active",
  },
  glance: { lots: 12, people: 20, members: 12 },
  finance: {
    hasBudget: true,
    fiscalYearStart: "2026-07-01",
    adminCents: 100000,
    maintenanceCents: 50000,
    leviedCents: 150000,
    noticeCount: 3,
    arrearsCents: 0,
    arrearsOutstandingCents: 0,
    lotsInArrears: 0,
  },
  attention: {
    pendingDecisions: 2,
    overdueDecisions: 0,
    openMaintenanceRequests: 0,
    openWorkOrders: 0,
    complianceOpen: 0,
    complianceOverdue: 0,
  },
  nextMeeting: null,
};

/**
 * Seed the mocked cache. `roles === undefined` models the detail query still
 * loading (roles not yet resolved) while the overview may already be present.
 */
function seed(roles: string[] | undefined, { overviewError = false } = {}) {
  mockUseQuery.mockImplementation((opts: { queryKey: readonly unknown[] }) => {
    const key = opts.queryKey;
    // ["scheme", id] — the shared detail/roles query.
    if (Array.isArray(key) && key[0] === "scheme" && key.length === 2) {
      return {
        data: roles === undefined ? undefined : { scheme: overviewData.scheme, roles },
        isPending: roles === undefined,
        isError: false,
        isRefetching: false,
      };
    }
    // ["scheme", id, "overview"].
    if (Array.isArray(key) && key[2] === "overview") {
      return {
        data: overviewError ? undefined : overviewData,
        isPending: false,
        isError: overviewError,
        isRefetching: false,
      };
    }
    return { data: undefined, isPending: false, isError: false, isRefetching: false };
  });
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockPush.mockClear();
});

afterEach(cleanup);

describe("SchemeHub — role-gated navigation", () => {
  it("hides Decisions from a plain owner and shows the owner-voiced subset", async () => {
    seed(["owner"]);
    await render(<SchemeHub />);

    // Officer-only destination must not leak to an owner.
    expect(screen.queryByText("Decisions")).toBeNull();
    // Owner sees the focused, owner-voiced subset.
    expect(screen.getByText("What I owe")).toBeOnTheScreen();
    expect(screen.getByText("Report an issue")).toBeOnTheScreen();
    // The officer "Finance" label is not used in the owner view.
    expect(screen.queryByText("Finance")).toBeNull();
    // Scheme-wide finance never appears in the owner presentation.
    expect(screen.queryByText("Levies outstanding")).toBeNull();
    expect(screen.queryByText("12 lots · levied $1,500.00")).toBeNull();
  });

  it("keeps personal owner tools available when the committee overview is unavailable", async () => {
    seed(["owner"], { overviewError: true });
    await render(<SchemeHub />);

    expect(screen.getByText("My levies")).toBeOnTheScreen();
    expect(screen.getByText("What I owe")).toBeOnTheScreen();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("gives a committee member the full register — governance is their job", async () => {
    seed(["committee_member"]);
    await render(<SchemeHub />);

    expect(screen.getByText("Decisions")).toBeOnTheScreen();
    expect(screen.getByText("Finance")).toBeOnTheScreen();
    expect(screen.getByText("Compliance")).toBeOnTheScreen();
    expect(screen.getByText("Lots")).toBeOnTheScreen();
    expect(screen.getByText("Levies outstanding")).toBeOnTheScreen();
    // They read the register as the committee, not as a resident.
    expect(screen.queryByText("What I owe")).toBeNull();
  });

  it("shows Decisions and the full finance register to an officer", async () => {
    seed(["chair"]);
    await render(<SchemeHub />);

    expect(screen.getByText("Decisions")).toBeOnTheScreen();
    expect(screen.getByText("Finance")).toBeOnTheScreen();
    // Owner-voiced labels are not used in the officer view.
    expect(screen.queryByText("What I owe")).toBeNull();
    expect(screen.queryByText("Report an issue")).toBeNull();
  });

  it("does not flash the officer layout before roles resolve", async () => {
    // Detail (roles) still loading, overview already present.
    seed(undefined);
    await render(<SchemeHub />);

    // No officer destination is rendered while roles are unknown.
    expect(screen.queryByText("Decisions")).toBeNull();
    // Nor is either nav set committed yet.
    expect(screen.queryByText("What I owe")).toBeNull();
    expect(screen.queryByText("Finance")).toBeNull();
  });
});
