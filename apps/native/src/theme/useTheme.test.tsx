import { renderHook } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { palette } from "./tokens";
import { useTheme, type Theme } from "./useTheme";

function mockScheme(scheme: "light" | "dark" | null | undefined) {
  jest.spyOn(ReactNative, "useColorScheme").mockReturnValue(scheme);
}

async function resolveTheme(
  scheme: "light" | "dark" | null | undefined,
): Promise<Theme> {
  mockScheme(scheme);
  const { result } = await renderHook(() => useTheme());
  return result.current;
}

describe("useTheme", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves the light (day) theme when the system is in light mode", async () => {
    const theme = await resolveTheme("light");

    expect(theme.dark).toBe(false);
    expect(theme.bg).toBe(palette.paper);
    expect(theme.surface).toBe(palette.paperRaised);
    expect(theme.text).toBe(palette.ink);
    expect(theme.accent).toBe(palette.eucalypt);
  });

  it("resolves the dark (night) theme when the system is in dark mode", async () => {
    const theme = await resolveTheme("dark");

    expect(theme.dark).toBe(true);
    expect(theme.bg).toBe(palette.night);
    expect(theme.surface).toBe(palette.nightRaised);
    expect(theme.text).toBe(palette.nightText);
    expect(theme.accent).toBe(palette.eucalyptNight);
  });

  it("falls back to the day theme when the system scheme is unset (null)", async () => {
    const theme = await resolveTheme(null);

    expect(theme.dark).toBe(false);
    expect(theme.bg).toBe(palette.paper);
  });

  it("lifts the accent for dark mode so night text/icons differ from day", async () => {
    const dayAccent = (await resolveTheme("light")).accent;
    jest.restoreAllMocks();
    const nightAccent = (await resolveTheme("dark")).accent;

    expect(nightAccent).not.toBe(dayAccent);
    expect(dayAccent).toBe(palette.eucalypt);
    expect(nightAccent).toBe(palette.eucalyptNight);
  });

  it("keeps solid accent fills eucalypt with a white label in BOTH themes", async () => {
    const day = await resolveTheme("light");
    jest.restoreAllMocks();
    const night = await resolveTheme("dark");

    // Invariant: dark mode swaps the ground, never the solid fill accent.
    expect(day.accentFill).toBe(palette.eucalypt);
    expect(night.accentFill).toBe(palette.eucalypt);
    expect(day.critFill).toBe(palette.crit);
    expect(night.critFill).toBe(palette.crit);
    expect(day.onAccent).toBe(palette.white);
    expect(night.onAccent).toBe(palette.white);
  });

  it("casts a card shadow in day but none in night", async () => {
    const day = await resolveTheme("light");
    jest.restoreAllMocks();
    const night = await resolveTheme("dark");

    expect(day.shadow).toBe(palette.ink);
    expect(night.shadow).toBe("transparent");
  });
});
