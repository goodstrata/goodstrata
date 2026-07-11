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
  inkMuted: "#5c646f",
  line: "#dce0e5",
  // dark ground
  night: "#0c1117",
  nightRaised: "#141a22",
  nightLine: "#2a313a",
  nightText: "#e5e8ec",
  nightMuted: "#9299a2",
  // semantic
  ok: "#0e6549",
  warn: "#8d5e00",
  crit: "#c52c2a",
  info: "#43607e",
  agent: "#157171",
  neutral: "#5c646f",
  okSoft: "rgba(14, 101, 73, 0.10)",
  warnSoft: "rgba(141, 94, 0, 0.10)",
  critSoft: "rgba(197, 44, 42, 0.10)",
  infoSoft: "rgba(67, 96, 126, 0.10)",
  agentSoft: "rgba(21, 113, 113, 0.10)",
  neutralSoft: "rgba(92, 100, 111, 0.10)",
  // Dark-mode eucalypt mirrors the web: mint fill with an ink label.
  eucalyptNight: "#74c0a0",
  eucalyptNightPress: "#82caae",
  eucalyptNightSoft: "rgba(116, 192, 160, 0.14)",
  // Status tones mirror the six web Registry tones.
  okNight: "#6cc29e",
  warnNight: "#e0ae57",
  critNight: "#ed756a",
  infoNight: "#88a8c9",
  agentNight: "#5ebdbc",
  neutralNight: "#989fa8",
  okNightSoft: "rgba(108, 194, 158, 0.16)",
  warnNightSoft: "rgba(224, 174, 87, 0.16)",
  critNightSoft: "rgba(237, 117, 106, 0.16)",
  infoNightSoft: "rgba(136, 168, 201, 0.16)",
  agentNightSoft: "rgba(94, 189, 188, 0.16)",
  neutralNightSoft: "rgba(152, 159, 168, 0.16)",
  // grounds for chrome
  white: "#ffffff",
  skeleton: "#eceae5",
  skeletonNight: "#1b2438",
  disc: "#f1efe9",
  scrim: "rgba(15, 24, 40, 0.45)",
} as const;

export const space = (n: number) => n * 4; // 4pt grid

export const type = {
  display: {
    fontFamily: "PublicSans_700Bold",
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  title: {
    fontFamily: "PublicSans_600SemiBold",
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.15,
  },
  body: { fontFamily: "PublicSans_400Regular", fontSize: 16, lineHeight: 23 },
  bodySmall: { fontFamily: "PublicSans_400Regular", fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: "PublicSans_400Regular", fontSize: 13, lineHeight: 18 },
  label: { fontFamily: "PublicSans_600SemiBold", fontSize: 13, lineHeight: 18, letterSpacing: 0.2 },
  figure: { fontFamily: "IBMPlexMono_600SemiBold", fontSize: 22, lineHeight: 28 },
  figureHero: { fontFamily: "IBMPlexMono_600SemiBold", fontSize: 34, lineHeight: 40 },
  figureSmall: { fontFamily: "IBMPlexMono_500Medium", fontSize: 15, lineHeight: 20 },
  eyebrow: {
    fontFamily: "IBMPlexMono_500Medium",
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
  },
} as const;

export const radius = { card: 14, control: 11, pill: 999 } as const;
