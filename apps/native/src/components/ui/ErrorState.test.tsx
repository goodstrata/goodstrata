import { fireEvent, render, screen } from "@testing-library/react-native";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("shows the default title and detail", async () => {
    await render(<ErrorState onRetry={jest.fn()} />);
    expect(screen.getByText("Couldn't load this")).toBeOnTheScreen();
    expect(screen.getByText("Check your connection and try again.")).toBeOnTheScreen();
  });

  it("shows a custom title and detail", async () => {
    await render(
      <ErrorState
        title="Ledger unavailable"
        detail="The ledger service is offline right now."
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByText("Ledger unavailable")).toBeOnTheScreen();
    expect(screen.getByText("The ledger service is offline right now.")).toBeOnTheScreen();
    expect(screen.queryByText("Couldn't load this")).toBeNull();
  });

  it("offers a retry action that calls onRetry", async () => {
    const onRetry = jest.fn();
    await render(<ErrorState onRetry={onRetry} />);

    const retry = screen.getByText("Try again");
    expect(retry).toBeOnTheScreen();

    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
