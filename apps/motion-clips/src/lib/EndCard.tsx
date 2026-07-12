import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, type Theme } from "../theme";
import { riseIn } from "./anim";
import { Motif } from "./Motif";

// Shared end-card: logo motif + wordmark + URL on --paper, the free/open/
// no-file line, then a eucalypt .btn.primary CTA the homepage embed dissolves
// into (plan sc.9).
export const EndCard: React.FC<{
  theme: Theme;
  url: string;
  cta: string;
}> = ({ theme, url, cta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = riseIn(frame, fps, 4);
  const b = riseIn(frame, fps, 14);
  const c = riseIn(frame, fps, 24);

  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          opacity: a.opacity,
          transform: `translateY(${a.translateY}px)`,
        }}
      >
        <Motif theme={theme} unit={1.1} />
        <span
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 58,
            letterSpacing: "-0.02em",
            color: theme.ink,
          }}
        >
          Good<span style={{ color: theme.primary }}>Strata</span>
        </span>
      </div>

      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 30,
          color: theme.mutedInk,
          letterSpacing: "0.01em",
          opacity: b.opacity,
          transform: `translateY(${b.translateY}px)`,
        }}
      >
        {url}
      </div>

      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 18,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: theme.faintInk,
          opacity: b.opacity,
          transform: `translateY(${b.translateY}px)`,
        }}
      >
        free · open source · we don&apos;t store your file
      </div>

      <div
        style={{
          marginTop: 8,
          padding: "16px 34px",
          borderRadius: 10,
          background: theme.primary,
          color: theme.onPrimary,
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 26,
          opacity: c.opacity,
          transform: `translateY(${c.translateY}px)`,
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};
