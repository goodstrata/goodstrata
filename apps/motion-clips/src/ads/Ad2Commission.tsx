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
import { dropIn, EASE_IN_OUT, fade, riseIn } from "../lib/anim";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { dark, fonts, light, type Theme } from "../theme";
import { HookText } from "./shared";

// AD2 "The commission" — 1080×1920 @ 30fps, timed to public/audio/ad2-vo.mp3
// (14.07s → 422 frames) + 45-frame end-card hold = 467 frames.
// Sentence gaps (silencedetect midpoints, s):
//   2.42 · 5.58 · 7.88 · 9.80 · 11.63 · 13.06 · 13.89(end)
//   s1  0.00  hook: "Your strata manager earns a commission" +
//             "…on YOUR insurance." lands on the 2.42s gap
//   s2  5.33  the premium card — the hidden % peels off → "You've never seen it."
//   s3  7.87  GoodStrata takes $0 — bold zero on the band
//   s4 11.50  end-card (dark, hook-question CTA) → hold to 467
const SCENES = {
  s1: { from: 0, dur: 160 },
  s2: { from: 160, dur: 76 },
  s3: { from: 236, dur: 109 },
  s4: { from: 345, dur: 122 },
} as const;
export const AD2_DURATION = 467; // 422 (VO) + 45 (~1.5s end-card hold)

const theme: Theme = light;

// ---- s1: the hook -------------------------------------------------------------
const Scene1: React.FC = () => (
  <AbsoluteFill
    style={{
      background: theme.ink,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 44,
      padding: "0 76px",
    }}
  >
    <HookText theme={theme} at={2} size={96}>
      Your strata manager earns a commission
    </HookText>
    <HookText theme={theme} at={73} size={96}>
      on <span style={{ color: dark.critical }}>YOUR</span> insurance.
    </HookText>
  </AbsoluteFill>
);

// ---- s2: the premium card with the hidden % peeling off ------------------------
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = riseIn(frame, fps, 2);
  // the cover peels up-right off the commission line over local 10–34
  const peel = interpolate(frame, [10, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const revealed = fade(frame, 20, 32);

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
          width: 900,
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 24,
          padding: "44px 52px 40px",
          boxShadow: "0 40px 84px -50px rgba(15,20,28,0.5)",
          opacity: card.opacity,
          transform: `translateY(${card.translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: theme.mutedInk,
          }}
        >
          Building insurance
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 20,
            paddingBottom: 26,
            borderBottom: `1.5px solid ${theme.line}`,
          }}
        >
          <span
            style={{
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 44,
              color: theme.ink,
            }}
          >
            Annual premium
          </span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
              fontSize: 52,
              color: theme.ink,
            }}
          >
            $14,280
          </span>
        </div>

        {/* the commission line, hiding under a peeling cover */}
        <div style={{ position: "relative", marginTop: 26 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              opacity: revealed,
            }}
          >
            <span
              style={{
                fontFamily: fonts.sans,
                fontWeight: 500,
                fontSize: 42,
                color: theme.faintInk,
              }}
            >
              incl. broker commission
            </span>
            <span
              style={{
                fontFamily: fonts.mono,
                fontWeight: 600,
                fontSize: 52,
                color: theme.critical,
              }}
            >
              ~20%
            </span>
          </div>
          {/* the peeling cover */}
          <div
            style={{
              position: "absolute",
              inset: -8,
              background: theme.card,
              border: `1.5px dashed ${theme.line}`,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fonts.mono,
              fontSize: 28,
              fontStyle: "italic",
              color: theme.faintInk,
              transformOrigin: "0% 100%",
              transform: `translate(${peel * 560}px, ${peel * -240}px) rotate(${peel * -18}deg)`,
              opacity: 1 - peel * 0.9,
              boxShadow: `0 ${10 + peel * 30}px 60px -30px rgba(15,20,28,0.5)`,
            }}
          >
            not itemised
          </div>
        </div>
      </div>
      <AdCaption theme={theme}>You&apos;ve never seen it.</AdCaption>
    </AbsoluteFill>
  );
};

// ---- s3: GoodStrata takes $0 — bold zero on the band ---------------------------
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const eyebrow = riseIn(frame, fps, 2);
  const zero = dropIn(frame, fps, 12);
  const sub = fade(frame, 44, 60);
  return (
    <AbsoluteFill
      style={{
        background: theme.bandBg,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 38,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: theme.bandMuted,
          opacity: eyebrow.opacity,
          transform: `translateY(${eyebrow.translateY}px)`,
        }}
      >
        GoodStrata takes
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          fontSize: 420,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: theme.bandFig,
          marginTop: 14,
          opacity: zero.opacity,
          transform: `translateY(${zero.translateY}px)`,
        }}
      >
        $0
      </div>
      <div
        style={{
          marginTop: 36,
          fontFamily: fonts.mono,
          fontSize: 40,
          color: theme.bandMuted,
          opacity: sub,
        }}
      >
        of your insurance. Ever.
      </div>
    </AbsoluteFill>
  );
};

// ---- the composition ------------------------------------------------------------
export const Ad2Commission: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/ad2-vo.mp3")} />
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
        <AdEndCard />
      </SceneFade>
    </Sequence>
  </AbsoluteFill>
);
