import { fireEvent, render, screen } from "@testing-library/react-native";
import { ReactNode } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Sheet } from "./Sheet";

// The Sheet reads safe-area insets. Provide them synchronously so the hook
// resolves without native layout measurement under jest.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  return <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>;
}

describe("Sheet", () => {
  it("shows its children while open", async () => {
    await render(
      <Sheet visible onClose={jest.fn()}>
        <Text>Confirm proxy vote</Text>
      </Sheet>,
      { wrapper },
    );

    expect(screen.getByText("Confirm proxy vote")).toBeOnTheScreen();
  });

  it("renders nothing while closed", async () => {
    await render(
      <Sheet visible={false} onClose={jest.fn()}>
        <Text>Confirm proxy vote</Text>
      </Sheet>,
      { wrapper },
    );

    expect(screen.queryByText("Confirm proxy vote")).toBeNull();
  });

  it("calls onClose when the backdrop is tapped", async () => {
    const onClose = jest.fn();
    await render(
      <Sheet visible onClose={onClose}>
        <Text>Confirm proxy vote</Text>
      </Sheet>,
      { wrapper },
    );

    fireEvent.press(screen.getByLabelText("Close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
