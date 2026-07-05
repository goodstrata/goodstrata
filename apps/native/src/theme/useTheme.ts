import { useColorScheme } from "react-native";
import { palette } from "./tokens";

/**
 * Semantic colours for the current scheme. Components never read `palette`
 * directly — always via this hook. Dark mode swaps the ground, never the
 * accent: solid eucalypt fills (`accentFill`) hold in both themes; accent
 * text/icons on dark ground use the lifted `accent`.
 */
export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  /** Accent for text and icons — lifted on night for AA. */
  accent: string;
  accentPress: string;
  accentSoft: string;
  /** Solid accent fill (buttons) — eucalypt in BOTH themes, white label. */
  accentFill: string;
  ok: string;
  warn: string;
  crit: string;
  /** Solid destructive fill (confirm buttons) — day crit in BOTH themes,
   * white label, mirroring accentFill. `crit` is lifted for night text AA
   * and must never carry a white label as a fill. */
  critFill: string;
  okSoft: string;
  warnSoft: string;
  critSoft: string;
  /** Label colour on solid accent/destructive fills. */
  onAccent: string;
  skeletonBase: string;
  /** Icon disc ground for empty/error states. */
  disc: string;
  /** Sheet backdrop scrim — same ink scrim in both themes. */
  scrim: string;
  /** Card shadow colour; dark theme casts no shadow. */
  shadow: string;
}

const day: Theme = {
  dark: false,
  bg: palette.paper,
  surface: palette.paperRaised,
  text: palette.ink,
  muted: palette.inkMuted,
  line: palette.line,
  accent: palette.eucalypt,
  accentPress: palette.eucalyptPress,
  accentSoft: palette.eucalyptSoft,
  accentFill: palette.eucalypt,
  ok: palette.ok,
  warn: palette.warn,
  crit: palette.crit,
  critFill: palette.crit,
  okSoft: palette.okSoft,
  warnSoft: palette.warnSoft,
  critSoft: palette.critSoft,
  onAccent: palette.white,
  skeletonBase: palette.skeleton,
  disc: palette.disc,
  scrim: palette.scrim,
  shadow: palette.ink,
};

const night: Theme = {
  dark: true,
  bg: palette.night,
  surface: palette.nightRaised,
  text: palette.nightText,
  muted: palette.nightMuted,
  line: palette.nightLine,
  accent: palette.eucalyptNight,
  accentPress: palette.eucalyptNightPress,
  accentSoft: palette.eucalyptNightSoft,
  accentFill: palette.eucalypt,
  ok: palette.okNight,
  warn: palette.warnNight,
  crit: palette.critNight,
  critFill: palette.crit,
  okSoft: palette.okNightSoft,
  warnSoft: palette.warnNightSoft,
  critSoft: palette.critNightSoft,
  onAccent: palette.white,
  skeletonBase: palette.skeletonNight,
  disc: palette.nightRaised,
  scrim: palette.scrim,
  shadow: "transparent",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? night : day;
}
