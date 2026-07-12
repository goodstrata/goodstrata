import type React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";

// Ken Burns wrapper: slow scale 1.0 -> 1.08 + gentle translate over the scene.
// Wraps arbitrary children (a code-built "brand treatment" card in v1). When a
// real still is available, pass `src` and it renders as a parallax background
// layer BEHIND the children — the v2 drop-in point (plan sc.1 / sc.8).
export const KenBurns: React.FC<{
  children?: React.ReactNode;
  durationInFrames: number;
  src?: string; // v2: <Img src> real AU still
  from?: number;
  to?: number;
  translate?: [number, number]; // px drift over the scene
  background?: string;
}> = ({
  children,
  durationInFrames,
  src,
  from = 1.0,
  to = 1.08,
  translate = [0, -24],
  background,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateRight: "clamp",
  });
  const tx = interpolate(frame, [0, durationInFrames], [0, translate[0]], {
    extrapolateRight: "clamp",
  });
  const ty = interpolate(frame, [0, durationInFrames], [0, translate[1]], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      {src ? (
        <AbsoluteFill
          style={{
            transform: `scale(${scale}) translate(${tx * 0.4}px, ${ty * 0.4}px)`,
          }}
        >
          <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
