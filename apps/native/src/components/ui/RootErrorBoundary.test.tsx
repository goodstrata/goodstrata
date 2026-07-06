import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { RootErrorBoundary } from "./RootErrorBoundary";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe("RootErrorBoundary", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // React logs the caught render error to console.error; that noise is
    // expected here, so swallow it to keep the test output clean.
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("renders its children when nothing throws", async () => {
    await render(
      <RootErrorBoundary>
        <Text>Happy child content</Text>
      </RootErrorBoundary>,
    );

    expect(screen.getByText("Happy child content")).toBeOnTheScreen();
  });

  it("shows the fallback screen instead of propagating a render throw", async () => {
    await render(
      <RootErrorBoundary>
        <Boom message="kaboom in render" />
      </RootErrorBoundary>,
    );

    // The failing child is not on screen...
    expect(screen.queryByText("kaboom child")).toBeNull();
    // ...and the recovery UI is shown with the recovery affordance.
    expect(screen.getByText("Something broke")).toBeOnTheScreen();
    expect(screen.getByText("Reset and try again")).toBeOnTheScreen();
  });

  it("surfaces the real error message so testers can report it", async () => {
    await render(
      <RootErrorBoundary>
        <Boom message="corrupt session token" />
      </RootErrorBoundary>,
    );

    expect(screen.getByText(/corrupt session token/)).toBeOnTheScreen();
  });
});
