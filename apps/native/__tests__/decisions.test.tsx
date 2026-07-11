import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import DecisionsScreen from "../app/scheme/[id]/decisions";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("../src/lib/api", () => ({
  api: jest.fn(),
  apiPost: jest.fn(),
  ApiError: class MockApiError extends Error {},
}));
jest.mock("../src/lib/auth", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "current-user" } }, isPending: false }),
  },
}));
jest.mock("../src/lib/roles", () => ({
  canDecide: () => true,
  useSchemeRoles: () => ["owner"],
  schemeQueryOptions: (id: string) => ({ queryKey: ["scheme", id] }),
}));
jest.mock("../src/components/ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: import("react").ReactNode }) =>
    visible ? children : null,
}));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "scheme-1" }),
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
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import { useQuery } from "@tanstack/react-query";

const mockUseQuery = useQuery as unknown as jest.Mock;

const baseDecision = {
  id: "decision-1",
  schemeId: "scheme-1",
  kind: "special_resolution",
  title: "Repair the western wall",
  summaryMd: "## Building report\n\nFirst paragraph.\n\nSecond paragraph with **full context**.",
  options: [
    { id: "approve", label: "Proceed" },
    { id: "decline", label: "Return for quotes" },
  ],
  evidence: [],
  subject: null,
  deciderRole: "all_owners",
  defaultOptionId: null,
  dueAt: "2026-07-20T00:00:00.000Z",
  followUp: null,
  status: "pending",
  requestedByRunId: null,
  decidedByUserId: null,
  resolution: null,
  decisionNote: null,
  resolvedAt: null,
  remindedAt: null,
  createdAt: "2026-07-11T00:00:00.000Z",
  decidedByName: null,
};

function seed(
  decisions: Record<string, unknown>[],
  votes: unknown = undefined,
  voteQuery: Record<string, unknown> = {},
) {
  mockUseQuery.mockImplementation((opts: { queryKey: readonly unknown[] }) => {
    const key = opts.queryKey;
    if (key[2] === "decisions") {
      return {
        data: { decisions },
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: jest.fn(),
      };
    }
    if (key[2] === "decision-votes") {
      return {
        data: votes,
        isPending: false,
        isError: false,
        refetch: jest.fn(),
        ...voteQuery,
      };
    }
    return {
      data: {
        scheme: { name: "Marina Views", planOfSubdivision: "PS123", tier: 2 },
        roles: ["owner"],
      },
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    };
  });
}

beforeEach(() => {
  mockUseQuery.mockReset();
});

afterEach(cleanup);

describe("Decisions", () => {
  it("shows the complete pending context and suppresses actions after the current user votes", async () => {
    seed([baseDecision], {
      votes: [
        {
          userId: "current-user",
          name: "Current Owner",
          choice: "approve",
          note: "The engineer's report is clear.",
          createdAt: "2026-07-11T01:00:00.000Z",
        },
      ],
      votesFor: 1,
      votesAgainst: 0,
      eligible: 4,
    });

    await render(<DecisionsScreen />);

    expect(screen.getByText(/Second paragraph with full context/)).toBeOnTheScreen();
    expect(screen.getByText(/You voted Proceed/)).toBeOnTheScreen();
    expect(screen.getAllByText(/engineer's report is clear/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Proceed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return for quotes" })).toBeNull();
  });

  it("offers the vote buttons once the tally confirms no recorded vote", async () => {
    seed([baseDecision], { votes: [], votesFor: 0, votesAgainst: 0, eligible: 4 });

    await render(<DecisionsScreen />);

    expect(screen.getByRole("button", { name: "Proceed" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Return for quotes" })).toBeOnTheScreen();
  });

  it("never offers vote buttons while the recorded-vote check is unavailable", async () => {
    // The tally query failed (e.g. flaky network): the user may already have
    // voted, so the actions must not be offered on an unknown state.
    seed([baseDecision], undefined, { isError: true });

    await render(<DecisionsScreen />);

    expect(screen.queryByRole("button", { name: "Proceed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return for quotes" })).toBeNull();
    expect(screen.getByText(/Couldn't check your recorded vote/)).toBeOnTheScreen();
  });

  it("never offers vote buttons while the recorded-vote check is still loading", async () => {
    seed([baseDecision], undefined, { isPending: true });

    await render(<DecisionsScreen />);

    expect(screen.queryByRole("button", { name: "Proceed" })).toBeNull();
    expect(screen.getByText(/Checking your recorded vote/)).toBeOnTheScreen();
  });

  it("opens resolved decisions with the chosen option, audit metadata, note and full context", async () => {
    const resolved = {
      ...baseDecision,
      status: "approved",
      resolution: { optionId: "approve" },
      decisionNote: "Approved after reviewing the final quote.",
      resolvedAt: "2026-07-12T05:30:00.000Z",
      decidedByUserId: "chair-1",
      decidedByName: "Casey Chair",
    };
    seed([resolved]);

    await render(<DecisionsScreen />);
    fireEvent.press(screen.getByRole("button", { name: /Repair the western wall/ }));

    expect(await screen.findByText("Recorded outcome: Proceed")).toBeOnTheScreen();
    expect(screen.getByText("By Casey Chair")).toBeOnTheScreen();
    expect(screen.getAllByText(/Approved after reviewing the final quote/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/Second paragraph with full context/)).toBeOnTheScreen();
  });
});
