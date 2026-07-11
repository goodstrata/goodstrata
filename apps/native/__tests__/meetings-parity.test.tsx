import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import MeetingsScreen from "../app/scheme/[id]/meetings";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQueries: () => [],
  useQuery: jest.fn(),
  useQueryClient: () => ({ invalidateQueries: jest.fn(() => Promise.resolve()) }),
}));

jest.mock("../src/lib/api", () => ({ api: jest.fn(), apiPost: jest.fn() }));

let mockOfficer = false;
jest.mock("../src/lib/roles", () => ({
  schemeQueryOptions: (schemeId: string) => ({
    queryKey: ["scheme", schemeId],
    queryFn: jest.fn(),
  }),
  useIsOfficer: () => mockOfficer,
}));

jest.mock("../src/lib/auth", () => ({ authClient: { getCookie: () => "session=cookie" } }));
jest.mock("expo-linking", () => ({ openURL: jest.fn(() => Promise.resolve()) }));
jest.mock("expo-file-system", () => ({
  File: class {},
  Paths: { cache: "/tmp" },
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "scheme-1", focus: "meeting-1" }),
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

import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiPost } from "../src/lib/api";

const mockUseMutation = useMutation as unknown as jest.Mock;
const mockUseQuery = useQuery as unknown as jest.Mock;
const mockApi = api as jest.Mock;
const mockApiPost = apiPost as jest.Mock;
const queryOptions: Array<{ queryKey: readonly unknown[]; queryFn?: () => unknown }> = [];

const pendingSubmission = {
  id: "submission-1",
  meetingId: "meeting-1",
  order: 2,
  title: "Install secure bicycle storage",
  body: "The current racks are full.",
  submittedByPersonId: "person-1",
  status: "pending" as const,
  motionText: "That secure bicycle storage be installed in the basement.",
  rejectedReason: null,
  createdAt: "2026-07-10T01:00:00.000Z",
};

const rejectedSubmission = {
  ...pendingSubmission,
  id: "submission-2",
  title: "Paint private balcony",
  status: "rejected" as const,
  rejectedReason: "The balcony coating is private lot property.",
};

const detail = {
  meeting: {
    id: "meeting-1",
    schemeId: "scheme-1",
    kind: "committee",
    title: "July committee meeting",
    scheduledAt: "2026-07-20T08:30:00.000Z",
    location: "Library",
    videoUrl: null,
    status: "notice_sent",
    noticeSentAt: "2026-07-01T00:00:00.000Z",
    quorumMet: null,
    minutesDocumentId: null,
  },
  agenda: [],
  submissions: [pendingSubmission, rejectedSubmission],
  motions: [],
  quorum: {
    representedLotCount: 0,
    totalLotCount: 2,
    representedEntitlement: 0,
    totalEntitlement: 2,
    quorate: false,
    quorumBasis: null,
  },
  chairLog: [],
  transcriptionStarted: false,
};

function queryResult(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isRefetching: false,
    isSuccess: true,
    refetch: jest.fn(() => Promise.resolve({ data })),
  };
}

beforeEach(() => {
  mockOfficer = false;
  queryOptions.length = 0;
  mockApi.mockReset().mockResolvedValue({});
  mockApiPost.mockReset().mockResolvedValue({});
  mockUseQuery.mockReset().mockImplementation((options) => {
    queryOptions.push(options);
    const key = options.queryKey as readonly unknown[];
    if (key.length === 2) {
      return queryResult({
        scheme: { name: "Marina Views", planOfSubdivision: "PS543921K", status: "active" },
        roles: mockOfficer ? ["chair"] : ["owner"],
      });
    }
    if (key[2] === "meeting") return queryResult(detail);
    if (key[2] === "lots" && key[3] === "mine") {
      return queryResult({ lots: [{ id: "lot-owned", lotNumber: "2" }] });
    }
    if (key[2] === "lots") {
      return queryResult({
        lots: [
          { id: "lot-owned", lotNumber: "2" },
          { id: "lot-other", lotNumber: "7" },
        ],
      });
    }
    if (key[2] === "people") {
      return queryResult({
        people: [
          {
            id: "person-2",
            givenName: "Sam",
            familyName: "Proxy",
            companyName: null,
            email: "sam@example.test",
          },
        ],
      });
    }
    return queryResult(undefined);
  });
  mockUseMutation.mockReset().mockImplementation((options) => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: (variables?: unknown) => {
      options.onMutate?.(variables);
      void Promise.resolve(options.mutationFn(variables)).then((result) =>
        options.onSuccess?.(result, variables),
      );
    },
  }));
});

afterEach(cleanup);

describe("Meetings parity", () => {
  it("uses the signed-in member's lots for proxy appointments", async () => {
    await render(<MeetingsScreen />);

    fireEvent.press(screen.getByLabelText("Appoint a proxy"));

    await waitFor(() =>
      expect(
        queryOptions.find(({ queryKey }) => queryKey.join("/") === "scheme/scheme-1/lots/mine"),
      ).toBeDefined(),
    );
    const ownedLotsQuery = queryOptions.find(
      ({ queryKey }) => queryKey.join("/") === "scheme/scheme-1/lots/mine",
    );
    await ownedLotsQuery?.queryFn?.();
    expect(mockApi).toHaveBeenCalledWith("/api/schemes/scheme-1/lots/mine");
    expect(screen.getByText("Lot 2")).toBeOnTheScreen();
    expect(screen.queryByText("Lot 7")).toBeNull();
  });

  it("shows submission status and lets a member propose an agenda item", async () => {
    await render(<MeetingsScreen />);

    expect(screen.getByText("Under review")).toBeOnTheScreen();
    expect(screen.getByText("Rejected")).toBeOnTheScreen();
    expect(screen.getByText(/Officer reason: The balcony coating/)).toBeOnTheScreen();
    expect(screen.queryByLabelText("Accept proposal")).toBeNull();

    fireEvent.press(screen.getByLabelText("Propose an agenda item"));
    fireEvent.changeText(
      await screen.findByPlaceholderText("What should the meeting consider?"),
      "Install parcel lockers",
    );
    await screen.findByDisplayValue("Install parcel lockers");
    fireEvent.changeText(
      screen.getByPlaceholderText("That the owners corporation resolves to…"),
      "That parcel lockers be installed in the foyer.",
    );
    await screen.findByDisplayValue("That parcel lockers be installed in the foyer.");
    fireEvent.changeText(
      screen.getByPlaceholderText("Why should members support this proposal?"),
      "To reduce missed deliveries.",
    );
    await screen.findByDisplayValue("To reduce missed deliveries.");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Submit proposal"));
    });

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/schemes/scheme-1/meetings/meeting-1/agenda-items",
        {
          title: "Install parcel lockers",
          motionText: "That parcel lockers be installed in the foyer.",
          rationale: "To reduce missed deliveries.",
        },
      ),
    );
  });

  it("lets an officer accept or reject a pending proposal through the review routes", async () => {
    mockOfficer = true;
    await render(<MeetingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Accept proposal"));
    });
    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/schemes/scheme-1/agenda-items/submission-1/accept",
        { resolutionType: "ordinary" },
      ),
    );

    fireEvent.press(screen.getByLabelText("Reject proposal"));
    fireEvent.changeText(
      await screen.findByPlaceholderText("Explain why this proposal cannot join the agenda"),
      "The proposal needs a funding estimate first.",
    );
    await screen.findByDisplayValue("The proposal needs a funding estimate first.");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Confirm rejection"));
    });
    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/schemes/scheme-1/agenda-items/submission-1/reject",
        { reason: "The proposal needs a funding estimate first." },
      ),
    );
  });
});
