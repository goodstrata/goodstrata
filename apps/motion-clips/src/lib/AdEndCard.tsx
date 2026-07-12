import type React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { dark, fonts } from "../theme";
import { riseIn } from "./anim";

// Shared end-card for the four vertical paid-social ads — identical treatment:
// the site's DARK-MODE deep-bluestone --paper, the on-dark logo lockup (the
// logo looks best on dark), then the hook question as the CTA, the fee-check
// URL in mono, and "Free." — all light/on-dark. Content is vertically centred,
// far inside the platform safe zones (top ~200px / bottom ~320px overlays).
export const AdEndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = riseIn(frame, fps, 3);
  const b = riseIn(frame, fps, 13);
  const c = riseIn(frame, fps, 22);
  const d = riseIn(frame, fps, 30);

  return (
    <AbsoluteFill
      style={{
        background: dark.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: "0 76px",
      }}
    >
      <Img
        src={staticFile("img/logo-on-dark.svg")}
        style={{
          width: 640,
          opacity: a.opacity,
          transform: `translateY(${a.translateY}px)`,
        }}
      />

      {/* the hook question IS the CTA */}
      <div
        style={{
          marginTop: 110,
          fontFamily: fonts.sans,
          fontWeight: 800,
          fontSize: 92,
          lineHeight: 1.06,
          letterSpacing: "-0.03em",
          color: dark.ink,
          textAlign: "center",
          maxWidth: 928,
          opacity: b.opacity,
          transform: `translateY(${b.translateY}px)`,
        }}
      >
        How much am I paying?
      </div>

      <div
        style={{
          marginTop: 44,
          fontFamily: fonts.mono,
          fontWeight: 500,
          fontSize: 42,
          letterSpacing: "0.01em",
          color: dark.mutedInk,
          textAlign: "center",
          opacity: c.opacity,
          transform: `translateY(${c.translateY}px)`,
        }}
      >
        goodstrata.com.au/what-am-i-paying
      </div>

      <div
        style={{
          marginTop: 52,
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 66,
          letterSpacing: "-0.02em",
          color: dark.primary,
          opacity: d.opacity,
          transform: `translateY(${d.translateY}px)`,
        }}
      >
        Free.
      </div>
    </AbsoluteFill>
  );
};
