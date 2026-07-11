import { cleanup, render, screen } from "@testing-library/react-native";
import SchemeFinance from "../app/scheme/[id]/finance";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueries: () => [],
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("../src/lib/api", () => ({ api: jest.fn() }));
jest.mock("../src/lib/files", () => ({ downloadAndShare: jest.fn() }));
jest.mock("../src/lib/roles", () => ({ useIsOfficer: () => true }));

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

import { useQuery } from "@tanstack/react-query";

const mockUseQuery = useQuery as unknown as jest.Mock;

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
  { stage: 1, daysOverdue: 1, label: "Friendly reminder" },
  { stage: 2, daysOverdue: 14, label: "Formal reminder" },
  { stage: 3, daysOverdue: 30, label: "Final notice" },
  { stage: 4, daysOverdue: 60, label: "Recovery decision" },
].map((entry, index) => ({
  ...entry,
  lotId: `lot-${index + 1}`,
  lotNumber: index + 1,
  outstandingCents: (index + 1) * 12_600,
  interestAccruedCents: 0,
  earliestDueOn: "2026-06-01",
}));

beforeEach(() => {
  mockUseQuery.mockImplementation((opts: { queryKey: readonly unknown[] }) => {
    const key = opts.queryKey;
    let data: unknown;
    if (key[2] === "overview") data = overview;
    if (key[2] === "arrears") data = { arrears };
    if (key[2] === "payments" && key[3] === "status") {
      data = {
        status: { provider: null, trustAccount: null, unmatchedCount: 0, lastPaymentAt: null },
      };
    }
    if (key[2] === "payments" && key.length === 3) data = { payments: [] };
    return {
      data,
      isPending: false,
      isError: false,
      isRefetching: false,
      isSuccess: true,
    };
  });
});

afterEach(() => {
  cleanup();
  mockUseQuery.mockReset();
});

describe("Finance arrears ladder", () => {
  it("renders every numeric API stage with its ladder vocabulary without crashing", async () => {
    await render(<SchemeFinance />);

    for (const entry of arrears) {
      expect(typeof entry.stage).toBe("number");
      expect(screen.getByText(entry.label)).toBeOnTheScreen();
    }
  });
});
