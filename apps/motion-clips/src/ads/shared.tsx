import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AgmCard } from "../lib/AgmCard";
import { fade, riseIn, slamIn } from "../lib/anim";
import { fonts, type Theme } from "../theme";

// Shared pieces for the 1080×1920 paid-social ads.
//
// Safe zones (TikTok / Reels UI overlays): all text and critical content stays
// inside the middle ~86% horizontally (76px side padding) and away from the
// top ~200px and bottom ~320px. Hooks + captions sit centre / upper-middle.

// A full-bleed hook screen on ink — pattern-interrupt text that slams in.
export const HookText: React.FC<{
  children: React.ReactNode;
  theme: Theme;
  at?: number; // scene-local slam frame
  size?: number;
  color?: string;
}> = ({ children, theme, at = 0, size = 104, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, scale } = slamIn(frame, fps, at);
  return (
    <div
      style={{
        fontFamily: fonts.sans,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.04,
        letterSpacing: "-0.03em",
        textAlign: "center",
        maxWidth: 928,
        color: color ?? theme.paper,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      {children}
    </div>
  );
};

// The phone-snap beat: a phone frames the AGM page, the shutter flashes,
// then an upload card rises in. Sized for the vertical canvas.
export const PhoneSnap: React.FC<{
  theme: Theme;
  flashAt?: number;
}> = ({ theme, flashAt = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flash = interpolate(
    frame,
    [flashAt, flashAt + 4, flashAt + 10],
    [0, 0.75, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const uiEnter = riseIn(frame, fps, flashAt + 12);
  const phoneDim = fade(frame, flashAt + 12, flashAt + 24, 1, 0.28);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {/* phone frame snapping the page */}
      <div style={{ position: "absolute", opacity: phoneDim }}>
        <div
          style={{
            width: 560,
            height: 1060,
            borderRadius: 66,
            border: `14px solid ${theme.ink}`,
            background: theme.card,
            boxShadow: "0 60px 130px -60px rgba(15,20,28,0.7)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ transform: "scale(0.46)" }}>
            <AgmCard theme={theme} />
          </div>
        </div>
      </div>

      {/* upload chip */}
      <div
        style={{
          opacity: uiEnter.opacity,
          transform: `translateY(${uiEnter.translateY}px)`,
          width: 820,
          padding: "46px 54px",
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 26,
          boxShadow: "0 40px 84px -50px rgba(15,20,28,0.5)",
          display: "flex",
          alignItems: "center",
          gap: 34,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: `7px solid ${theme.line}`,
            borderTopColor: theme.primary,
            transform: `rotate(${(frame / fps) * 360}deg)`,
          }}
        />
        <div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 40,
              color: theme.ink,
            }}
          >
            Reading your AGM pack…
          </div>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 26,
              color: theme.faintInk,
              marginTop: 8,
            }}
          >
            agm-2026.pdf
          </div>
        </div>
      </div>

      {/* shutter flash */}
      <AbsoluteFill
        style={{ background: "white", opacity: flash, pointerEvents: "none" }}
      />
    </AbsoluteFill>
  );
};
