import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, type Theme } from "../theme";
import { riseIn } from "./anim";

// Burned-in caption for the 1080×1920 paid-social ads. Unlike the 16:9
// lower-third Caption, this sits UPPER-MIDDLE — inside platform safe zones
// (below the top ~200px of platform UI, far above the bottom ~320px where
// captions/CTAs get covered) and within the middle ~86% horizontally.
// Huge Public Sans 700 on a ~92% paper scrim so the ad still reads muted.
export const AdCaption: React.FC<{
  children: React.ReactNode;
  theme: Theme;
  onBand?: boolean; // flips to deep-eucalypt band colours
  top?: number; // px from the top edge — default 300 (upper-middle)
  size?: number; // font size — default 72
  delay?: number; // scene-local enter frame
}> = ({ children, theme, onBand = false, top = 300, size = 72, delay = 2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, translateY } = riseIn(frame, fps, delay);

  const scrim = onBand
    ? `color-mix(in oklch, ${theme.bandBg} 82%, transparent)`
    : `color-mix(in oklch, ${theme.paper} 92%, transparent)`;
  const textColor = onBand ? theme.bandInk : theme.ink;
  const border = onBand ? theme.bandLine : theme.line;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        display: "flex",
        justifyContent: "center",
        padding: "0 76px", // keeps the scrim inside the middle ~86%
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontSize: size,
          lineHeight: 1.12,
          color: textColor,
          background: scrim,
          border: `1.5px solid ${border}`,
          borderRadius: 24,
          padding: "28px 42px",
          maxWidth: 928,
          textAlign: "center",
          backdropFilter: "blur(7px)",
          WebkitBackdropFilter: "blur(7px)",
          boxShadow: "0 26px 60px -34px rgba(15,20,28,0.6)",
        }}
      >
        {children}
      </div>
    </div>
  );
};
