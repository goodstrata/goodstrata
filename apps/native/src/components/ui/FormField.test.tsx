import { fireEvent, render, screen } from "@testing-library/react-native";
import { createRef } from "react";
import type { TextInput } from "react-native";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("uses its visible label as the input's accessible name", async () => {
    await render(<FormField label="Street address" value="" onChangeText={jest.fn()} />);

    expect(screen.getByLabelText("Street address")).toBeOnTheScreen();
  });

  it("preserves focus callbacks and forwards its input ref", async () => {
    const onFocus = jest.fn();
    const ref = createRef<TextInput>();
    await render(<FormField ref={ref} label="Email" value="" onFocus={onFocus} />);

    fireEvent(screen.getByLabelText("Email"), "focus", {});

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(ref.current).not.toBeNull();
  });
});
