import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label", async () => {
    await render(<Button label="Approve" onPress={jest.fn()} />);
    expect(screen.getByText("Approve")).toBeOnTheScreen();
  });

  it("fires onPress when tapped", async () => {
    const onPress = jest.fn();
    await render(<Button label="Pay levy" onPress={onPress} />);
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = jest.fn();
    await render(<Button label="Approve" onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("blocks onPress and shows a spinner instead of the label while pending", async () => {
    const onPress = jest.fn();
    await render(<Button label="Submitting" onPress={onPress} pending />);
    // Label is replaced by the ActivityIndicator while pending.
    expect(screen.queryByText("Submitting")).toBeNull();
    // The button is still present (accessibility label preserved) but inert.
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("marks the button busy while pending", async () => {
    await render(<Button label="Submitting" onPress={jest.fn()} pending />);
    expect(screen.getByRole("button")).toBeBusy();
  });

  it.each([
    "primary",
    "secondary",
    "destructive",
  ] as const)("renders the %s variant with its label", async (variant) => {
    await render(<Button label="Do it" variant={variant} onPress={jest.fn()} />);
    expect(screen.getByText("Do it")).toBeOnTheScreen();
  });

  it("renders a leading icon alongside the label", async () => {
    await render(<Button label="With icon" onPress={jest.fn()} icon={<Text>ICON</Text>} />);
    expect(screen.getByText("ICON")).toBeOnTheScreen();
    expect(screen.getByText("With icon")).toBeOnTheScreen();
  });
});
