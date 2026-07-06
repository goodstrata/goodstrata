import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import SignIn from "../app/sign-in";
import { authClient } from "../src/lib/auth";

// The auth client hits the production API and pulls in expo-secure-store at
// import time; stub it so we can drive sign-in outcomes from the test.
jest.mock("../src/lib/auth", () => ({
  authClient: {
    signIn: {
      email: jest.fn(),
      social: jest.fn(),
    },
  },
}));

// Router: capture navigation without a real navigation tree.
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
}));

// Haptics fire-and-forget; selectionAsync must return a thenable (.catch).
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));

jest.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SafeAreaView: ({ children, ...p }: any) => React.createElement(View, p, children),
    SafeAreaProvider: ({ children }: any) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const mockedSignInEmail = authClient.signIn.email as jest.Mock;

const signInButton = () => screen.getByRole("button", { name: "Sign in" });

// The screen has no placeholders/labels/testIDs, so fields are found by display
// value. Under React 19 a changeText commits asynchronously, so we await each
// value landing before moving on — and re-query rather than reuse a reference
// that a re-render would have detached. After the email lands it is the only
// non-empty input, leaving the password as the sole remaining empty field.
async function fillCredentials(email: string, password: string) {
  fireEvent.changeText(screen.getAllByDisplayValue("")[0], email);
  const passwordField = await screen.findByDisplayValue("");
  fireEvent.changeText(passwordField, password);
  await screen.findByDisplayValue(password);
}

beforeEach(() => {
  // Reset only the mocks this suite drives (a blanket jest.clearAllMocks()
  // also disturbs jest-expo's host mocks). Default to a successful sign-in.
  mockReplace.mockClear();
  mockedSignInEmail.mockReset().mockResolvedValue({ error: null });
});

afterEach(cleanup);

describe("SignIn screen", () => {
  it("renders the heading and the email + password fields", async () => {
    await render(<SignIn />);

    expect(screen.getByLabelText("GoodStrata")).toBeOnTheScreen();
    expect(screen.getByText(/The building runs itself/)).toBeOnTheScreen();
    expect(screen.getByText("Email")).toBeOnTheScreen();
    expect(screen.getByText("Password")).toBeOnTheScreen();
    // Two empty entry fields plus the primary action.
    expect(screen.getAllByDisplayValue("")).toHaveLength(2);
    expect(signInButton()).toBeOnTheScreen();
  });

  it("keeps Sign in disabled until both email and password are filled", async () => {
    await render(<SignIn />);

    // Nothing typed yet.
    expect(signInButton()).toBeDisabled();

    // Only the email filled — still not enough.
    fireEvent.changeText(screen.getAllByDisplayValue("")[0], "resident@example.com");
    const passwordField = await screen.findByDisplayValue("");
    expect(signInButton()).toBeDisabled();

    // Both filled — now actionable.
    fireEvent.changeText(passwordField, "hunter2");
    await waitFor(() => expect(signInButton()).toBeEnabled());
  });

  it("does not attempt to sign in while the button is disabled", async () => {
    await render(<SignIn />);

    fireEvent.press(signInButton());

    expect(mockedSignInEmail).not.toHaveBeenCalled();
  });

  it("calls authClient.signIn.email with the entered values and navigates on success", async () => {
    await render(<SignIn />);

    await fillCredentials("resident@example.com", "hunter2");
    fireEvent.press(signInButton());

    await waitFor(() =>
      expect(mockedSignInEmail).toHaveBeenCalledWith({
        email: "resident@example.com",
        password: "hunter2",
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(tabs)"));
  });

  it("shows an error message when sign in fails", async () => {
    mockedSignInEmail.mockResolvedValue({
      error: { message: "Invalid email or password" },
    });

    await render(<SignIn />);

    await fillCredentials("resident@example.com", "wrong-pass");
    fireEvent.press(signInButton());

    expect(await screen.findByText("Invalid email or password")).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
