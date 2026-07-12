import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ListRow } from "./ListRow";

describe("ListRow", () => {
  it("renders its title", async () => {
    await render(<ListRow title="Water charges" />);
    expect(screen.getByText("Water charges")).toBeOnTheScreen();
  });

  it("renders the subtitle second line when provided", async () => {
    await render(<ListRow title="Lot 12" subtitle="Unit entitlement 8" />);
    expect(screen.getByText("Lot 12")).toBeOnTheScreen();
    expect(screen.getByText("Unit entitlement 8")).toBeOnTheScreen();
  });

  it("omits the subtitle when none is given", async () => {
    await render(<ListRow title="Lot 12" />);
    expect(screen.queryByText("Unit entitlement 8")).toBeNull();
  });

  it("renders the right-hand content (figure / pill / date)", async () => {
    await render(<ListRow title="Levy notice" right={<Text>$420.00</Text>} />);
    expect(screen.getByText("$420.00")).toBeOnTheScreen();
  });

  it("fires onPress when the row is pressable and tapped", async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Open ballot" onPress={onPress} />);

    fireEvent.press(screen.getByRole("button"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("exposes an accessible button role only when pressable", async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Tap me" onPress={onPress} />);
    expect(screen.getByRole("button")).toBeOnTheScreen();
  });

  it("is not a button and cannot be pressed when no onPress is set", async () => {
    await render(<ListRow title="Static row" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
