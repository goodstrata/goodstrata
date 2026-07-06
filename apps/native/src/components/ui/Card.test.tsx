import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its children", async () => {
    await render(
      <Card>
        <Text>Levy overview</Text>
      </Card>,
    );
    expect(screen.getByText("Levy overview")).toBeOnTheScreen();
  });

  it("renders as a plain surface (no button role) when not pressable", async () => {
    await render(
      <Card>
        <Text>Static content</Text>
      </Card>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Static content")).toBeOnTheScreen();
  });

  it("exposes a button role and fires onPress when tapped", async () => {
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress}>
        <Text>Tap me</Text>
      </Card>,
    );
    const button = screen.getByRole("button");
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("still renders children when padding is disabled", async () => {
    await render(
      <Card padded={false}>
        <Text>Flush content</Text>
      </Card>,
    );
    expect(screen.getByText("Flush content")).toBeOnTheScreen();
  });
});
