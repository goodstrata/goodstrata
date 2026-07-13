import { cleanup, render, screen } from "@testing-library/react-native";
import Notifications from "../app/(tabs)/notifications";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueries: jest.fn(),
  useMutation: () => ({
    mutate: jest.fn(),
    isError: false,
    isPending: false,
    variables: undefined,
  }),
  useQueryClient: () => ({
    cancelQueries: jest.fn(),
    getQueryData: jest.fn(),
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock("../src/lib/api", () => ({ api: jest.fn(), apiPost: jest.fn() }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
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

const schemes = [
  { scheme: { id: "scheme-a", name: "Rose Street" }, roles: ["owner"] },
  { scheme: { id: "scheme-b", name: "Harbour View" }, roles: ["owner"] },
];

function queryResult(data: unknown, options: { pending?: boolean; error?: boolean } = {}) {
  return {
    data,
    isPending: options.pending ?? false,
    isError: options.error ?? false,
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseQuery.mockReturnValue(queryResult({ schemes }));
  mockUseQueries.mockReset();
  mockPush.mockReset();
});

afterEach(() => {
  cleanup();
  mockUseQuery.mockReset();
  mockUseQueries.mockReset();
});

describe("Notifications feed completeness", () => {
  it("keeps the building name on multi-building notifications with body copy", async () => {
    mockUseQueries.mockReturnValue([
      queryResult({
        notifications: [
          {
            id: "notification-1",
            schemeId: "scheme-a",
            userId: "user-1",
            title: "Budget adopted",
            body: "The new levy schedule is ready.",
            category: "finance",
            related: null,
            readAt: null,
            createdAt: "2026-07-13T00:00:00.000Z",
          },
        ],
      }),
      queryResult({ notifications: [] }),
    ]);

    await render(<Notifications />);

    expect(screen.getByText("The new levy schedule is ready. · Rose Street")).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        "Budget adopted. The new levy schedule is ready. · Rose Street. Unread",
      ),
    ).toBeOnTheScreen();
  });

  it("does not claim all caught up when one building feed failed", async () => {
    mockUseQueries.mockReturnValue([
      queryResult({ notifications: [] }),
      queryResult(undefined, { error: true }),
    ]);

    await render(<Notifications />);

    expect(screen.getByText("Couldn't check every building")).toBeOnTheScreen();
    expect(screen.getByText("Try again")).toBeOnTheScreen();
    expect(screen.queryByText("You're all caught up")).toBeNull();
  });
});
