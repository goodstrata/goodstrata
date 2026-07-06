import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import Svg, { Polygon } from "react-native-svg";

describe("native libraries under jest", () => {
  it("renders a reanimated entering view", async () => {
    await render(
      <Animated.View entering={FadeInDown} testID="anim">
        <Text>animated</Text>
      </Animated.View>,
    );
    expect(screen.getByText("animated")).toBeOnTheScreen();
  });

  it("renders react-native-svg", async () => {
    await render(
      <Svg testID="svg">
        <Polygon points="0,0 10,0 5,10" />
      </Svg>,
    );
    expect(screen.getByTestId("svg")).toBeOnTheScreen();
  });
});
