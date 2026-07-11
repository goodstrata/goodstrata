import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Screen } from "./Screen";

jest.mock("react-native", () => {
  const React = require("react");
  const actual = jest.requireActual("react-native");
  const MockRefreshControl = (props: Record<string, unknown>) =>
    React.createElement(actual.View, { testID: "screen-refresh-control", ...props });
  return new Proxy(actual, {
    get(target, property, receiver) {
      return property === "RefreshControl"
        ? MockRefreshControl
        : Reflect.get(target, property, receiver);
    },
  });
});

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SafeAreaView: ({
      children,
      ...props
    }: { children?: import("react").ReactNode } & Record<string, unknown>) =>
      React.createElement(View, { testID: "screen-safe-area", ...props }, children),
  };
});

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

  it("keeps the top safe-area edge by default for screens without a native header", async () => {
    await render(
      <Screen title="Home">
        <Text>rows</Text>
      </Screen>,
    );

    expect(screen.getByTestId("screen-safe-area").props.edges).toEqual(["top"]);
  });

  it("omits the top safe-area edge when the native stack header already owns it", async () => {
    await render(
      <Screen title="Finance" topInset={false}>
        <Text>rows</Text>
      </Screen>,
    );

    expect(screen.getByTestId("screen-safe-area").props.edges).toEqual([]);
  });

  it("keeps pull-to-refresh active until the refresh promise settles", async () => {
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const onRefresh = jest.fn(() => refreshPromise);
    await render(
      <Screen title="Documents" onRefresh={onRefresh}>
        <Text>rows</Text>
      </Screen>,
    );

    await act(async () => {
      fireEvent(screen.getByTestId("screen-refresh-control"), "refresh");
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("screen-refresh-control").props.refreshing).toBe(true);

    await act(async () => {
      resolveRefresh();
      await refreshPromise;
      await Promise.resolve();
    });

    expect(screen.getByTestId("screen-refresh-control").props.refreshing).toBe(false);
  });
});
