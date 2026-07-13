import { cleanup, render, screen } from "@testing-library/react-native";
import Overview from "../app/(tabs)/index";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueries: jest.fn(),
  useMutation: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    refetchQueries: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock("../src/lib/api", () => ({ api: jest.fn(), apiPost: jest.fn() }));
jest.mock("../src/lib/auth", () => ({
  authClient: {
    useSession: () => ({ data: { user: { name: "Alex Owner", email: "alex@example.com" } } }),
    getCookie: jest.fn(),
  },
}));
jest.mock("../src/lib/config", () => ({ API_ORIGIN: "https://example.test" }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SafeAreaView: ({
      children,
      ...props
    }: { children?: import("react").ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, children),
    SafeAreaProvider: ({ children }: { children?: import("react").ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import { useQueries, useQuery } from "@tanstack/react-query";

const mockUseQuery = useQuery as unknown as jest.Mock;
const mockUseQueries = useQueries as unknown as jest.Mock;

let mockRoles: string[];

const scheme = {
  id: "scheme-1",
  name: "Marina Views",
  planOfSubdivision: "PS 543921K",
  status: "active",
};

const overview = {
  onboarding: { hasLots: true, hasInsurance: true, ready: true, status: "active" },
  glance: { lots: 12, people: 20, members: 12 },
  finance: {
    hasBudget: true,
    noticeCount: 4,
    arrearsOutstandingCents: 126_000,
    lotsInArrears: 4,
  },
  attention: {
    pendingDecisions: 2,
    overdueDecisions: 0,
    openMaintenanceRequests: 3,
    openWorkOrders: 0,
    complianceOverdue: 1,
  },
  nextMeeting: null,
};

const lots = [
  { id: "lot-1", lotNumber: "1", unitNumber: "101" },
  { id: "lot-2", lotNumber: "2", unitNumber: "102" },
  { id: "lot-3", lotNumber: "3", unitNumber: "103" },
];

function queryResult(data: unknown) {
  return {
    data,
    isPending: false,
    isError: false,
    isRefetching: false,
    isSuccess: true,
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockRoles = ["owner"];
  mockPush.mockReset();
  mockUseQuery.mockImplementation((opts: { queryKey: readonly unknown[] }) => {
    const key = opts.queryKey;
    if (key[0] === "schemes") {
      return queryResult({ schemes: [{ scheme, roles: mockRoles }] });
    }
    if (key[2] === "lots" && key[3] === "mine") {
      return queryResult({ lots });
    }
    return queryResult(undefined);
  });
  mockUseQueries.mockImplementation((opts: { queries: { queryKey: readonly unknown[] }[] }) => {
    if (opts.queries[0]?.queryKey[2] === "overview") return [queryResult(overview)];
    if (opts.queries[0]?.queryKey[2] === "lot-statement") {
      return [
        queryResult({ balanceCents: 10_000 }),
        queryResult({ balanceCents: -9_000 }),
        queryResult({ balanceCents: 5_000 }),
      ];
    }
    return [];
  });
});

afterEach(() => {
  cleanup();
  mockUseQuery.mockReset();
  mockUseQueries.mockReset();
});

describe("Home — role presentation", () => {
  it("keeps a plain owner on personal obligations, without scheme management queues", async () => {
    await render(<Overview />);

    expect(screen.getByText("My levies")).toBeOnTheScreen();
    expect(screen.getByLabelText("150 dollars")).toBeOnTheScreen();
    expect(screen.queryByText("Levies outstanding")).toBeNull();
    expect(screen.queryByLabelText("1,260 dollars")).toBeNull();
    expect(screen.queryByText("4 lots in arrears")).toBeNull();
    expect(screen.queryByText("2 decisions waiting")).toBeNull();
    expect(screen.queryByText("3 maintenance items open")).toBeNull();
    expect(screen.queryByText("1 compliance item overdue")).toBeNull();
  });

  it("keeps the scheme-wide summary and management attention for committee members", async () => {
    mockRoles = ["committee_member"];
    await render(<Overview />);

    expect(screen.getByText("Levies outstanding")).toBeOnTheScreen();
    expect(screen.getByLabelText("1,260 dollars")).toBeOnTheScreen();
    expect(screen.getByText("4 lots in arrears")).toBeOnTheScreen();
    expect(screen.getByText("2 decisions waiting")).toBeOnTheScreen();
    expect(screen.queryByText("My levies")).toBeNull();
  });
});
