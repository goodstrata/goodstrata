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
import { AgmCard } from "../lib/AgmCard";
import { slamIn } from "../lib/anim";
import { FeeCard } from "../lib/FeeCard";
import { KenBurns } from "../lib/KenBurns";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { fees, fonts, light, money, type Theme } from "../theme";
import { HookText, PhoneSnap } from "./shared";

// AD3 "POV: AGM papers" — 1080×1920 @ 30fps, timed to public/audio/ad3-vo.mp3
// (16.39s → 492 frames) + 45-frame end-card hold = 537 frames.
// Sentence gaps (silencedetect midpoints, s):
//   1.12 · 7.94 · 9.34 · 11.83 · 13.80 · 15.62 · 16.02(end)
//   s1  0.00  hook: "POV: you actually read your AGM papers."
//   s2  3.33  the statement scrolls — line items stamp in one by one,
//             "Photocopying?!" lands ~8.3s and hangs through the 8.9–9.8s beat
//   s3  9.80  "There's one number they never total up."
//   s4 12.03  snap-a-photo
//   s5 13.83  the total slams in on the band
//   s6 15.40  end-card (dark, hook-question CTA) → hold to 537
const SCENES = {
  s1: { from: 0, dur: 100 },
  s2: { from: 100, dur: 194 },
  s3: { from: 294, dur: 67 },
  s4: { from: 361, dur: 54 },
  s5: { from: 415, dur: 47 },
  s6: { from: 462, dur: 75 },
} as const;
export const AD3_DURATION = 537; // 492 (VO) + 45 (~1.5s end-card hold)

const theme: Theme = light;

// ---- s1: hook over the AGM papers ----------------------------------------------
const Scene1: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <KenBurns durationInFrames={SCENES.s1.dur} from={1.02} to={1.1} translate={[0, -14]}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: "scale(0.86) translateY(180px)", opacity: 0.5 }}>
          <AgmCard theme={theme} />
        </div>
      </AbsoluteFill>
    </KenBurns>
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 76px",
      }}
    >
      <HookText theme={theme} at={2} size={100} color={theme.ink}>
        POV: you actually read your <span style={{ color: theme.primary }}>AGM papers.</span>
      </HookText>
    </AbsoluteFill>
  </AbsoluteFill>
);

// ---- s2: line items stamp in one by one -----------------------------------------
// Stamps track the VO enumeration (3.33–8.9s); "Photocopying?!" lands ~8.3s
// (scene-local 148) and hangs through the beat of silence.
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <FeeCard
          theme={theme}
          label="Management fee"
          amount={money(fees.base)}
          dropAt={12}
          width={900}
        />
        <FeeCard
          theme={theme}
          label="Disbursements"
          amount={money(fees.disbursements)}
          dropAt={52}
          width={900}
        />
        <FeeCard
          theme={theme}
          label="Meeting fees"
          amount={money(fees.meetings)}
          dropAt={90}
          width={900}
        />
        <FeeCard theme={theme} label="Arrears notices" amount="$540" dropAt={122} width={900} />
        <FeeCard
          theme={theme}
          label="Photocopying?!"
          amount="$214.80"
          dropAt={148}
          tone="critical"
          width={900}
        />
      </div>
      {frame >= 148 ? (
        <AdCaption theme={theme} delay={148} size={84}>
          <span style={{ color: theme.critical }}>Photocopying?!</span>
        </AdCaption>
      ) : (
        <AdCaption theme={theme}>Line item… after line item…</AdCaption>
      )}
    </AbsoluteFill>
  );
};

// ---- s3: the number they never total up ------------------------------------------
const Scene3: React.FC = () => (
  <AbsoluteFill
    style={{
      background: theme.ink,
      alignItems: "center",
      justifyContent: "center",
      padding: "0 76px",
    }}
  >
    <HookText theme={theme} at={2} size={96}>
      There&apos;s one number they <span style={{ color: theme.bandFig }}>never total up.</span>
    </HookText>
  </AbsoluteFill>
);

// ---- s4: snap a photo --------------------------------------------------------------
const Scene4: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <PhoneSnap theme={theme} flashAt={10} />
    <AdCaption theme={theme} top={280}>
      So snap a photo.
    </AdCaption>
  </AbsoluteFill>
);

// ---- s5: the total slams in on the band ---------------------------------------------
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slam = slamIn(frame, fps, 4);
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
          opacity: slam.opacity,
        }}
      >
        The total
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
          opacity: slam.opacity,
          transform: `scale(${slam.scale})`,
        }}
      >
        {money(fees.total)}
        <span style={{ fontSize: 84, color: theme.bandMuted }}> /yr</span>
      </div>
    </AbsoluteFill>
  );
};

// ---- the composition -----------------------------------------------------------------
export const Ad3Pov: React.FC = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/ad3-vo.mp3")} />
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
