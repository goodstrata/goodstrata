/**
 * The Registry, native edition. Same system as apps/web and the site:
 * eucalypt for action and identity, ink on paper for reading, Plex Mono for
 * figures. Dark mode swaps the ground, never the accent.
 */
export const palette = {
  eucalypt: "#095b41",
  eucalyptPress: "#0b6e4f",
  eucalyptSoft: "#e7f2ed",
  ink: "#0f1828",
  paper: "#faf9f7",
  paperRaised: "#ffffff",
  inkMuted: "#5a6472",
  line: "#e5e2dc",
  // dark ground
  night: "#0c1220",
  nightRaised: "#141c2e",
  nightLine: "#232d42",
  nightText: "#eef0f4",
  nightMuted: "#98a2b3",
  // semantic
  ok: "#0e7a4e",
  warn: "#9a6b00",
  crit: "#b42318",
  okSoft: "#e6f3ec",
  warnSoft: "#f7efd9",
  critSoft: "#fbe9e7",
  // accent lifted for AA on night ground — text/icons only; solid fills stay eucalypt
  eucalyptNight: "#2f9d78",
  eucalyptNightPress: "#37b389",
  eucalyptNightSoft: "rgba(47, 157, 120, 0.14)",
  // status tones lifted for AA on night ground
  okNight: "#3fae7c",
  warnNight: "#d0a13a",
  critNight: "#f0705f",
  okNightSoft: "rgba(63, 174, 124, 0.16)",
  warnNightSoft: "rgba(208, 161, 58, 0.16)",
  critNightSoft: "rgba(240, 112, 95, 0.16)",
  // grounds for chrome
  white: "#ffffff",
  skeleton: "#eceae5",
  skeletonNight: "#1b2438",
  disc: "#f1efe9",
  scrim: "rgba(15, 24, 40, 0.45)",
} as const;

export const space = (n: number) => n * 4; // 4pt grid

export const type = {
  display: { fontFamily: "PublicSans_700Bold", fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  title: { fontFamily: "PublicSans_600SemiBold", fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  body: { fontFamily: "PublicSans_400Regular", fontSize: 16, lineHeight: 23 },
  bodySmall: { fontFamily: "PublicSans_400Regular", fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: "PublicSans_400Regular", fontSize: 13, lineHeight: 18 },
  label: { fontFamily: "PublicSans_600SemiBold", fontSize: 13, lineHeight: 18, letterSpacing: 0.2 },
  figure: { fontFamily: "IBMPlexMono_600SemiBold", fontSize: 22, lineHeight: 28 },
  figureHero: { fontFamily: "IBMPlexMono_600SemiBold", fontSize: 34, lineHeight: 40 },
  figureSmall: { fontFamily: "IBMPlexMono_500Medium", fontSize: 15, lineHeight: 20 },
  eyebrow: { fontFamily: "IBMPlexMono_500Medium", fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: "uppercase" as const },
} as const;

export const radius = { card: 14, control: 11, pill: 999 } as const;
