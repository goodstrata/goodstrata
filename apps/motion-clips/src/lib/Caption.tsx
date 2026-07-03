import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, type Theme } from "../theme";
import { riseIn } from "./anim";

// Burned-in caption, bottom third, Public Sans 700 on a ~92% paper scrim.
// Carries the muted homepage cut (1-7 words). `onBand` flips to band colours.
export const Caption: React.FC<{
  children: React.ReactNode;
  theme: Theme;
  onBand?: boolean;
  emphasis?: string; // optional word rendered in eucalypt (colour = emphasis)
}> = ({ children, theme, onBand = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, translateY } = riseIn(frame, fps, 2);

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
        bottom: 104,
        display: "flex",
        justifyContent: "center",
        padding: "0 80px",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontSize: 68,
          lineHeight: 1.12,
          color: textColor,
          background: scrim,
          border: `1.5px solid ${border}`,
          borderRadius: 22,
          padding: "26px 46px",
          maxWidth: 1640,
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
