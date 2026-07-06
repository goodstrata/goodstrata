import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { PressableScale } from "./PressableScale";

describe("PressableScale", () => {
  it("renders its children", async () => {
    await render(
      <PressableScale testID="scale">
        <Text>Tap me</Text>
      </PressableScale>,
    );
    expect(screen.getByText("Tap me")).toBeOnTheScreen();
  });

  it("fires onPress when pressed", async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale testID="scale" onPress={onPress}>
        <Text>Tap me</Text>
      </PressableScale>,
    );
    fireEvent.press(screen.getByTestId("scale"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale testID="scale" disabled onPress={onPress}>
        <Text>Tap me</Text>
      </PressableScale>,
    );
    fireEvent.press(screen.getByTestId("scale"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
