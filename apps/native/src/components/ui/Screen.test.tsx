import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Screen } from "./Screen";

describe("Screen", () => {
  it("renders its children within the scaffold", async () => {
    await render(
      <Screen title="Overview">
        <Text>Body content</Text>
      </Screen>,
    );
    expect(screen.getByText("Body content")).toBeOnTheScreen();
  });

  it("paints the title as the header", async () => {
    await render(
      <Screen title="Levies">
        <Text>rows</Text>
      </Screen>,
    );
    expect(screen.getByText("Levies")).toBeOnTheScreen();
  });

  it("shows the mono eyebrow above the title when provided", async () => {
    await render(
      <Screen title="Lot 12" eyebrow="PS 543921K · TIER 2">
        <Text>rows</Text>
      </Screen>,
    );
    expect(screen.getByText("PS 543921K · TIER 2")).toBeOnTheScreen();
  });

  it("renders a header action when headerRight is given", async () => {
    await render(
      <Screen title="Inbox" headerRight={<Text>Edit</Text>}>
        <Text>rows</Text>
      </Screen>,
    );
    expect(screen.getByText("Edit")).toBeOnTheScreen();
  });

  it("renders children in the non-scrolling (FlatList) variant", async () => {
    await render(
      <Screen title="Documents" scroll={false}>
        <Text>list body</Text>
      </Screen>,
    );
    expect(screen.getByText("list body")).toBeOnTheScreen();
    expect(screen.getByText("Documents")).toBeOnTheScreen();
  });
});
