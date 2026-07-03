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
        bottom: 92,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontSize: 40,
          lineHeight: 1.15,
          color: textColor,
          background: scrim,
          border: `1px solid ${border}`,
          borderRadius: 14,
          padding: "16px 28px",
          maxWidth: 1400,
          textAlign: "center",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          boxShadow: "0 18px 44px -30px rgba(15,20,28,0.55)",
        }}
      >
        {children}
      </div>
    </div>
  );
};
