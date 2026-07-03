import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AdCaption } from "../lib/AdCaption";
import { AdEndCard } from "../lib/AdEndCard";
import { countUp, fade, riseIn } from "../lib/anim";
import { FeeCard } from "../lib/FeeCard";
import "../lib/loadFonts";
import { SceneFade } from "../lib/SceneFade";
import { dark, fees, fonts, light, money, type Theme } from "../theme";
import { HookText, PhoneSnap } from "./shared";

// AD1 "Screwed" — 1080×1920 @ 30fps, timed to public/audio/ad1-vo.mp3
// (19.78s → 594 frames) + 45-frame end-card hold = 639 frames.
// Sentence gaps (ffmpeg silencedetect, -32dB/0.28s), midpoints in seconds:
//   2.47 · 3.93 · 5.57 · 9.09 · 12.61 · 17.32 · 18.32 · 19.35(end)
//   s1  0.00  hook: "You know you're getting screwed…" (beat 2)
//             + "…by your strata." lands on the 2.47s gap
//   s2  3.93  fee bricks: meeting fees / arrears notices / 'admin time'
//   s3  9.09  insurance commission — never shown (oxide red)
//   s4 12.61  phone-snap of the AGM page
//   s5 14.33  the $8,400 count-up on the deep-eucalypt band
//   s6 17.32  end-card (dark, hook-question CTA) → hold to 639
const SCENES = {
  s1: { from: 0, dur: 118 },
  s2: { from: 118, dur: 154 },
  s3: { from: 272, dur: 106 },
  s4: { from: 378, dur: 52 },
  s5: { from: 430, dur: 90 },
  s6: { from: 520, dur: 119 },
} as const;
export const AD1_DURATION = 639; // 594 (VO) + 45 (~1.5s end-card hold)

const theme: Theme = light;

// ---- s1: the hook slams in over ink ------------------------------------------
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
    <HookText theme={theme} at={2}>
      You know you&apos;re getting{" "}
      <span style={{ color: dark.critical }}>screwed</span>
    </HookText>
    <HookText theme={theme} at={74}>
      by your strata.
    </HookText>
  </AbsoluteFill>
);

// ---- s2: fee bricks drop in rapid succession ---------------------------------
// Drops track the VO enumeration across 3.93–9.09s (scene-local 17/62/104).
const Scene2: React.FC = () => (
  <AbsoluteFill
    style={{
      background: theme.paper,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <FeeCard
        theme={theme}
        label="+ Meeting & AGM fees"
        amount={money(fees.meetings)}
        dropAt={17}
        width={900}
      />
      <FeeCard
        theme={theme}
        label="+ Arrears notices"
        amount="$540"
        dropAt={62}
        width={900}
      />
      <FeeCard
        theme={theme}
        label="+ 'Admin time'"
        amount={money(fees.disbursements)}
        dropAt={104}
        width={900}
      />
    </div>
    <AdCaption theme={theme}>
      Meeting fees. Arrears notices. &lsquo;Admin time.&rsquo;
    </AdCaption>
  </AbsoluteFill>
);

// ---- s3: the commission line — greyed, oxide red -----------------------------
const Scene3: React.FC = () => (
  <AbsoluteFill
    style={{
      background: theme.paper,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <FeeCard
      theme={theme}
      label="Insurance commission"
      amount="never shown"
      dropAt={8}
      tone="critical"
      greyed
      width={900}
    />
    <AdCaption theme={theme}>
      And a commission on your insurance —{" "}
      <span style={{ color: theme.critical }}>never shown.</span>
    </AdCaption>
  </AbsoluteFill>
);

// ---- s4: snap a photo of the page --------------------------------------------
const Scene4: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <PhoneSnap theme={theme} />
    <AdCaption theme={theme} top={280}>
      Snap a photo of the page.
    </AdCaption>
  </AbsoluteFill>
);

// ---- s5: the real number counts up on the deep-eucalypt band -----------------
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const value = countUp(frame, fees.total, 6, 30);
  const enter = riseIn(frame, fps, 2);
  const subOpacity = fade(frame, 42, 58);
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
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        Your real number
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          fontSize: 236,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: theme.bandFig,
          marginTop: 26,
        }}
      >
        {money(value)}
        <span style={{ fontSize: 84, color: theme.bandMuted }}> /yr</span>
      </div>
      <div
        style={{
          marginTop: 40,
          fontFamily: fonts.mono,
          fontSize: 40,
          color: theme.bandMuted,
          opacity: subOpacity,
        }}
      >
        {fees.lots} lots × $700 = {money(fees.total)}
      </div>
    </AbsoluteFill>
  );
};

// ---- the composition ----------------------------------------------------------
export const Ad1Screwed: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/ad1-vo.mp3")} />
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
        <Scene5 />
      </SceneFade>
    </Sequence>
    <Sequence from={SCENES.s6.from} durationInFrames={SCENES.s6.dur}>
      <SceneFade>
        <AdEndCard />
      </SceneFade>
    </Sequence>
  </AbsoluteFill>
);
