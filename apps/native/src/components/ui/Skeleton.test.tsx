import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a loading placeholder", async () => {
    await render(<Skeleton />);

    expect(screen.toJSON()).not.toBeNull();
  });

  it("applies the requested dimensions", async () => {
    await render(<Skeleton width={120} height={24} radius={8} />);

    const style = StyleSheet.flatten(screen.root.props.style);
    expect(style.width).toBe(120);
    expect(style.height).toBe(24);
    expect(style.borderRadius).toBe(8);
  });

  it("defaults to a full-width 16pt block", async () => {
    await render(<Skeleton />);

    const style = StyleSheet.flatten(screen.root.props.style);
    expect(style.width).toBe("100%");
    expect(style.height).toBe(16);
    expect(style.borderRadius).toBe(6);
  });

  it("is hidden from assistive technology", async () => {
    await render(<Skeleton />);

    expect(screen.root.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.root.props.accessibilityElementsHidden).toBe(true);
  });
});
