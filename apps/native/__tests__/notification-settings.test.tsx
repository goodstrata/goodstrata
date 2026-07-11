import { cleanup, render, screen } from "@testing-library/react-native";
import NotificationSettings from "../app/settings/notifications";

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      smsAvailable: false,
      phone: null,
      groups: [
        {
          key: "finance",
          label: "Finance",
          types: [
            {
              type: "levy_due",
              label: "Levy due",
              help: "When a levy is due",
              channels: { in_app: true, email: true, sms: true, push: true },
            },
          ],
        },
      ],
    },
    isPending: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useMutation: () => ({ mutate: jest.fn() }),
  useQueryClient: () => ({
    cancelQueries: jest.fn(),
    getQueryData: jest.fn(),
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock("../src/lib/api", () => ({ api: jest.fn(), apiPatch: jest.fn() }));
jest.mock("../src/lib/pushNotifications", () => ({ registerPushToken: jest.fn() }));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
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
  };
});

afterEach(cleanup);

describe("Notification settings", () => {
  it("renders an unavailable SMS preference off even when the stored preference is on", async () => {
    await render(<NotificationSettings />);

    const sms = screen.getByRole("switch", { name: "Levy due, SMS" });
    expect(sms.props.value).toBe(false);
    expect(sms.props.disabled).toBe(true);

    const email = screen.getByRole("switch", { name: "Levy due, Email" });
    expect(email.props.value).toBe(true);
    expect(email.props.disabled).toBe(false);
  });
});
