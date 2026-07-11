import type React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AdCaption } from "../lib/AdCaption";
import { AdEndCard } from "../lib/AdEndCard";
import {
  countUp,
  dropIn,
  EASE_IN_OUT,
  EASE_OUT,
  fade,
  riseIn,
  slamIn,
} from "../lib/anim";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { fees, fonts, light, money, type Theme } from "../theme";

// AD4 "$8,400 vs $0" — 1080×1920 @ 30fps, timed to public/audio/ad4-vo.mp3
// (17.00s → 510 frames) + 45-frame end-card hold = 555 frames.
// Sentence gaps (silencedetect midpoints, s):
//   4.97 · 6.75 · 9.29 · 10.96 · 13.11 · 13.98 · 15.43 · 16.61(end)
//   s1  0.00  hook: giant $8,400/yr counts up instantly —
//             "what a 12-lot building pays for admin"
//   s2  4.97  struck through → $0 drops in eucalypt (~7.3s, on the beat)
//   s3  9.29  "You still approve everything." — decision-card tap
//   s4 13.10  "Free." then "Open source."
//   s5 15.43  end-card (dark, hook-question CTA) → hold to 555
const SCENES = {
  s1: { from: 0, dur: 149 },
  s2: { from: 149, dur: 130 },
  s3: { from: 279, dur: 114 },
  s4: { from: 393, dur: 70 },
  s5: { from: 463, dur: 92 },
} as const;
export const AD4_DURATION = 555; // 510 (VO) + 45 (~1.5s end-card hold)

const theme: Theme = light;

const bigFig: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  fontSize: 230,
  lineHeight: 1,
  letterSpacing: "-0.03em",
};

// ---- s1: the hook — $8,400 counts up instantly ---------------------------------
const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const value = countUp(frame, fees.total, 2, 16); // instant — the number IS the hook
  const sub = fade(frame, 20, 34);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: "0 76px",
      }}
    >
      <div style={{ ...bigFig, color: theme.ink }}>
        {money(value)}
        <span style={{ fontSize: 84, color: theme.mutedInk }}> /yr</span>
      </div>
      <div
        style={{
          marginTop: 48,
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 58,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: theme.mutedInk,
          textAlign: "center",
          maxWidth: 900,
          opacity: sub,
        }}
      >
        what a 12-lot building pays for admin
      </div>
    </AbsoluteFill>
  );
};

// ---- s2: struck through → $0 drops with a thunk ----------------------------------
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // the strike draws across the $8,400 as the scene opens
  const strike = interpolate(frame, [6, 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  // $0 lands at ~7.3s global (scene-local 70), on the beat after the strike
  const zero = dropIn(frame, fps, 70);
  const eyebrow = fade(frame, 70, 84);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 90,
      }}
    >
      {/* the struck $8,400 */}
      <div style={{ position: "relative" }}>
        <div style={{ ...bigFig, fontSize: 170, color: theme.mutedInk }}>
          {money(fees.total)}
          <span style={{ fontSize: 64, color: theme.faintInk }}> /yr</span>
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "52%",
            height: 8,
            width: `${strike * 100}%`,
            background: `color-mix(in oklch, ${theme.critical} 72%, transparent)`,
            borderRadius: 4,
          }}
        />
      </div>

      {/* $0 thunks in, eucalypt */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 36,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: theme.accentInk,
            marginBottom: 22,
            opacity: eyebrow,
          }}
        >
          With GoodStrata
        </div>
        <div
          style={{
            ...bigFig,
            fontSize: 340,
            color: theme.primary,
            opacity: zero.opacity,
            transform: `translateY(${zero.translateY}px)`,
          }}
        >
          $0
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- s3: you still approve everything — decision-card tap --------------------------
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 6);
  // cursor slides onto Approve and taps ~local 46
  const cursorX = interpolate(frame, [14, 46], [200, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const cursorY = interpolate(frame, [14, 46], [150, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const tap = interpolate(frame, [46, 54, 64], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [46, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
          width: 900,
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 28,
          padding: "48px 52px 46px",
          boxShadow: "0 60px 130px -60px rgba(15,20,28,0.65)",
          position: "relative",
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: theme.mutedInk,
          }}
        >
          Decision required
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 48,
            letterSpacing: "-0.02em",
            color: theme.ink,
            marginTop: 12,
          }}
        >
          Dispatch plumber for roof leak
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 30,
            color: theme.mutedInk,
            marginTop: 10,
          }}
        >
          Quote $420 · within the $1,000 committee limit
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 40 }}>
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "24px 0",
              borderRadius: 16,
              background: theme.primary,
              color: theme.onPrimary,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 36,
              boxShadow: `0 0 ${glow * 52}px ${glow * 10}px color-mix(in oklch, ${theme.primary} 60%, transparent)`,
            }}
          >
            Approve
          </div>
          <div
            style={{
              padding: "24px 44px",
              borderRadius: 16,
              border: `1.5px solid ${theme.line}`,
              color: theme.ink,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 36,
            }}
          >
            Hold
          </div>
        </div>

        {/* tap ripple + cursor over Approve */}
        <div
          style={{
            position: "absolute",
            left: 250,
            bottom: 64,
            transform: `translate(${cursorX}px, ${cursorY}px)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -28,
              top: -28,
              width: 92,
              height: 92,
              borderRadius: "50%",
              border: `4px solid ${theme.primary}`,
              opacity: tap,
              transform: `scale(${0.4 + tap * 1.1})`,
            }}
          />
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: theme.ink,
              opacity: 0.82,
            }}
          />
        </div>
      </div>
      <AdCaption theme={theme}>You still approve everything.</AdCaption>
    </AbsoluteFill>
  );
};

// ---- s4: Free. Open source. ----------------------------------------------------------
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = slamIn(frame, fps, 6);
  const b = slamIn(frame, fps, 32);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 800,
          fontSize: 150,
          letterSpacing: "-0.03em",
          color: theme.primary,
          opacity: a.opacity,
          transform: `scale(${a.scale})`,
        }}
      >
        Free.
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 800,
          fontSize: 110,
          letterSpacing: "-0.03em",
          color: theme.ink,
          opacity: b.opacity,
          transform: `scale(${b.scale})`,
        }}
      >
        Open source.
      </div>
    </AbsoluteFill>
  );
};

// ---- the composition -------------------------------------------------------------------
export const Ad4Zero: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/ad4-vo.mp3")} />
    <MusicBed src="audio/music-ads.mp3" volume={0.22} />
    <Sequence from={SCENES.s1.from} durationInFrames={SCENES.s1.dur}>
      <SceneFade>
        <Scene1 />
      </SceneFade>
    </Sequence>
    <Sequence from={SCENES.s2.from} durationInFrames={SCENES.s2.dur}>
      <SceneFade>
        <Scene2 />
      </SceneFade>
    </Sequence>
    <Sequence from={SCENES.s3.from} durationInFrames={SCENES.s3.dur}>
      <SceneFade>
        <Scene3 />
      </SceneFade>
    </Sequence>
    <Sequence from={SCENES.s4.from} durationInFrames={SCENES.s4.dur}>
      <SceneFade>
        <Scene4 />
      </SceneFade>
    </Sequence>
    <Sequence from={SCENES.s5.from} durationInFrames={SCENES.s5.dur}>
      <SceneFade>
        <AdEndCard />
      </SceneFade>
    </Sequence>
  </AbsoluteFill>
);
