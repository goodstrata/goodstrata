import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import SchemeFinance from "../app/scheme/[id]/finance";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueries: jest.fn(),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("../src/lib/api", () => ({ api: jest.fn() }));
jest.mock("../src/lib/files", () => ({ downloadAndShare: jest.fn() }));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ id: "scheme-1" }),
}));

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SafeAreaView: ({
      children,
      ...props
    }: { children?: import("react").ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, children),
  };
});

import { useQueries, useQuery } from "@tanstack/react-query";

const mockUseQuery = useQuery as unknown as jest.Mock;
const mockUseQueries = useQueries as unknown as jest.Mock;
const mockLotsRefetch = jest.fn();
const mockFailedStatementRefetch = jest.fn();

let mockRoles: string[] | undefined;
let mockLots: { id: string; lotNumber: string; unitNumber: string | null }[];
let mockStatements: Record<string, unknown>[];

const overview = {
  scheme: {
    id: "scheme-1",
    name: "Marina Views",
    planOfSubdivision: "PS 543921K",
    tier: 2,
    status: "active",
  },
  finance: {
    hasBudget: true,
    fiscalYearStart: "2026-07-01",
    adminCents: 100_000,
    maintenanceCents: 50_000,
    leviedCents: 150_000,
    noticeCount: 4,
    arrearsCents: 126_000,
    arrearsOutstandingCents: 126_000,
    lotsInArrears: 4,
  },
};

const arrears = [
  {
    lotId: "lot-4",
    lotNumber: 4,
    outstandingCents: 126_000,
    daysOverdue: 60,
    stage: 4,
    interestAccruedCents: 0,
    earliestDueOn: "2026-06-01",
  },
];

function queryResult(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isPending: false,
    isError: false,
    isRefetching: false,
    isSuccess: true,
    refetch: jest.fn(),
    ...overrides,
  };
}

function successfulStatement(balanceCents: number) {
  return queryResult({ balanceCents });
}

beforeEach(() => {
  mockRoles = ["owner"];
  mockLots = [
    { id: "lot-1", lotNumber: "1", unitNumber: "101" },
    { id: "lot-2", lotNumber: "2", unitNumber: "102" },
    { id: "lot-3", lotNumber: "3", unitNumber: "103" },
  ];
  mockStatements = [
    successfulStatement(10_000),
    successfulStatement(-9_000),
    successfulStatement(5_000),
  ];
  mockLotsRefetch.mockReset();
  mockFailedStatementRefetch.mockReset();
  mockUseQueries.mockImplementation(() => mockStatements);
  mockUseQuery.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const key = opts.queryKey;
    if (key.length === 2 && key[0] === "scheme") {
      return queryResult(
        mockRoles === undefined ? undefined : { scheme: overview.scheme, roles: mockRoles },
        mockRoles === undefined ? { isPending: true, isSuccess: false } : undefined,
      );
    }
    if (key[2] === "overview") return queryResult(overview);
    if (key[2] === "payments" && key[3] === "status") {
      return queryResult({
        status: { provider: null, trustAccount: null, unmatchedCount: 0, lastPaymentAt: null },
      });
    }
    if (key[2] === "payments" && key.length === 3) {
      return opts.enabled === false
        ? queryResult(undefined, { isPending: true, isSuccess: false })
        : queryResult({ payments: [] });
    }
    if (key[2] === "arrears") {
      return opts.enabled === false
        ? queryResult(undefined, { isPending: true, isSuccess: false })
        : queryResult({ arrears });
    }
    if (key[2] === "lots" && key[3] === "mine") {
      return opts.enabled === false
        ? queryResult(undefined, { isPending: true, isSuccess: false })
        : queryResult({ lots: mockLots }, { refetch: mockLotsRefetch });
    }
    return queryResult(undefined);
  });
});

afterEach(() => {
  cleanup();
  mockUseQuery.mockReset();
  mockUseQueries.mockReset();
});

describe("Finance — loading-safe role presentation", () => {
  it("shows only personal obligations for an owner and does not net credits", async () => {
    await render(<SchemeFinance />);

    expect(screen.getByText("Amount due on my lots")).toBeOnTheScreen();
    expect(screen.getByLabelText("150 dollars")).toBeOnTheScreen();
    expect(screen.getByText("2 of your lots due")).toBeOnTheScreen();
    expect(screen.queryByLabelText("1,260 dollars")).toBeNull();
    expect(screen.queryByText("4 lots overdue")).toBeNull();
    expect(screen.queryByText("Recent payments")).toBeNull();
    expect(screen.queryByText("Arrears")).toBeNull();
    expect(screen.queryByText("Officer tools")).toBeNull();
  });

  it("blocks totals and paid-up claims when any owner statement fails, with retry", async () => {
    mockStatements = [
      successfulStatement(10_000),
      queryResult(undefined, {
        isError: true,
        isSuccess: false,
        refetch: mockFailedStatementRefetch,
      }),
      successfulStatement(-9_000),
    ];
    await render(<SchemeFinance />);

    expect(screen.getByText("Couldn't load your levy balance")).toBeOnTheScreen();
    expect(screen.getByText(/no total or payment status is shown/i)).toBeOnTheScreen();
    expect(screen.queryByText("Paid up")).toBeNull();
    expect(screen.queryByText("Amount due on my lots")).toBeNull();
    expect(screen.queryByLabelText("0 dollars")).toBeNull();

    fireEvent.press(screen.getAllByText("Try again")[0]);
    expect(mockLotsRefetch).toHaveBeenCalled();
    expect(mockFailedStatementRefetch).toHaveBeenCalled();
  });

  it("gives a committee member the full finance register without officer tools", async () => {
    mockRoles = ["committee_member"];
    mockStatements = [];
    await render(<SchemeFinance />);

    expect(screen.getByText("Levies outstanding")).toBeOnTheScreen();
    expect(screen.getAllByLabelText("1,260 dollars").length).toBeGreaterThan(0);
    expect(screen.getByText("Recent payments")).toBeOnTheScreen();
    expect(screen.getByText("Arrears")).toBeOnTheScreen();
    expect(screen.getByText("Recovery decision")).toBeOnTheScreen();
    expect(screen.queryByText("My lot statements")).toBeNull();
    expect(screen.queryByText("Officer tools")).toBeNull();
  });

  it("retains the full register and management link for an officer", async () => {
    mockRoles = ["treasurer"];
    mockStatements = [];
    await render(<SchemeFinance />);

    expect(screen.getByText("Levies outstanding")).toBeOnTheScreen();
    expect(screen.getByText("Recent payments")).toBeOnTheScreen();
    expect(screen.getByText("Officer tools")).toBeOnTheScreen();
    expect(screen.getByText("Manage budgets, levies and payments")).toBeOnTheScreen();
  });

  it("shows only neutral skeletons until roles resolve", async () => {
    mockRoles = undefined;
    mockStatements = [];
    await render(<SchemeFinance />);

    expect(screen.queryByText("Levies outstanding")).toBeNull();
    expect(screen.queryByText("Amount due on my lots")).toBeNull();
    expect(screen.queryByText("My lot statements")).toBeNull();
    expect(screen.queryByText("Recent payments")).toBeNull();
    expect(screen.queryByText("Paid up")).toBeNull();
  });
});
