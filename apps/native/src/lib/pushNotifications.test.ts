jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
  DEFAULT_ACTION_IDENTIFIER: "default",
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("./api", () => ({ apiDelete: jest.fn(), apiPost: jest.fn() }));
jest.mock("./auth", () => ({ authClient: { useSession: jest.fn() } }));

import { pushDataToReadAnchor } from "./pushNotifications";

describe("pushDataToReadAnchor", () => {
  it("returns the scheme and notification ids from a valid push payload", () => {
    expect(
      pushDataToReadAnchor({
        schemeId: "scheme-1",
        notificationId: "notification-9",
        unrelated: "ignored",
      }),
    ).toEqual({ schemeId: "scheme-1", notificationId: "notification-9" });
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a primitive", "scheme-1"],
    ["a missing scheme id", { notificationId: "notification-9" }],
    ["an empty scheme id", { schemeId: "", notificationId: "notification-9" }],
    ["a non-string scheme id", { schemeId: 1, notificationId: "notification-9" }],
    ["a missing notification id", { schemeId: "scheme-1" }],
    ["an empty notification id", { schemeId: "scheme-1", notificationId: "" }],
    ["a non-string notification id", { schemeId: "scheme-1", notificationId: 9 }],
  ])("rejects %s", (_label, payload) => {
    expect(pushDataToReadAnchor(payload)).toBeNull();
  });
});
