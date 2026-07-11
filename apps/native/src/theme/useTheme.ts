import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import { palette } from "./tokens";

/**
 * Semantic colours for the current scheme. Components never read `palette`
 * directly — always via this hook. Dark mode swaps the ground, never the
 * accent: deep eucalypt by day and the web's mint eucalypt after hours.
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
  /** Solid primary button fill. */
  accentFill: string;
  ok: string;
  warn: string;
  crit: string;
  info: string;
  agent: string;
  neutral: string;
  /** Solid destructive fill (confirm buttons) — day crit in BOTH themes,
   * white label, mirroring accentFill. `crit` is lifted for night text AA
   * and must never carry a white label as a fill. */
  critFill: string;
  okSoft: string;
  warnSoft: string;
  critSoft: string;
  infoSoft: string;
  agentSoft: string;
  neutralSoft: string;
  /** Label colour on a solid primary fill. */
  onPrimary: string;
  /** Label colour on destructive fills and critical badges. */
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
  info: palette.info,
  agent: palette.agent,
  neutral: palette.neutral,
  critFill: palette.crit,
  okSoft: palette.okSoft,
  warnSoft: palette.warnSoft,
  critSoft: palette.critSoft,
  infoSoft: palette.infoSoft,
  agentSoft: palette.agentSoft,
  neutralSoft: palette.neutralSoft,
  onPrimary: palette.white,
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
  accentFill: palette.eucalyptNight,
  ok: palette.okNight,
  warn: palette.warnNight,
  crit: palette.critNight,
  info: palette.infoNight,
  agent: palette.agentNight,
  neutral: palette.neutralNight,
  critFill: palette.crit,
  okSoft: palette.okNightSoft,
  warnSoft: palette.warnNightSoft,
  critSoft: palette.critNightSoft,
  infoSoft: palette.infoNightSoft,
  agentSoft: palette.agentNightSoft,
  neutralSoft: palette.neutralNightSoft,
  onPrimary: "#0a121f",
  onAccent: palette.white,
  skeletonBase: palette.skeletonNight,
  disc: palette.nightRaised,
  scrim: palette.scrim,
  shadow: "transparent",
};

export type ThemePreference = "system" | "light" | "dark";
const THEME_KEY = "goodstrata_theme_preference";
let preference: ThemePreference = "system";
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitPreference(): void {
  for (const listener of listeners) listener();
}

/** Load the persisted override before the splash is hidden. Idempotent. */
export function hydrateThemePreference(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = SecureStore.getItemAsync(THEME_KEY)
    .then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        preference = stored;
      }
      hydrated = true;
      emitPreference();
    })
    .catch(() => {
      hydrated = true;
    });
  return hydration;
}

export async function setThemePreference(next: ThemePreference): Promise<void> {
  preference = next;
  emitPreference();
  await SecureStore.setItemAsync(THEME_KEY, next);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => preference,
    () => "system",
  );
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const preferred = useThemePreference();
  const scheme = preferred === "system" ? system : preferred;
  return scheme === "dark" ? night : day;
}
