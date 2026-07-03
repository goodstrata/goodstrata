import type React from "react";
import { Composition } from "remotion";
import { AD1_DURATION, Ad1Screwed } from "./ads/Ad1Screwed";
import { AD2_DURATION, Ad2Commission } from "./ads/Ad2Commission";
import { AD3_DURATION, Ad3Pov } from "./ads/Ad3Pov";
import { AD4_DURATION, Ad4Zero } from "./ads/Ad4Zero";
import { C1_DURATION, C1TheNumber } from "./clips/C1TheNumber";
import { C2_DURATION, C2TheMoneyIsCode } from "./clips/C2TheMoneyIsCode";
import { C3_DURATION, C3OneLaptop } from "./clips/C3OneLaptop";
import { C4_DURATION, C4ScheduleB } from "./clips/C4ScheduleB";
import { C5_DURATION, C5Handbook } from "./clips/C5Handbook";

// Build-time only. Registers the five GoodStrata homepage explainer clips.
// 16:9 master (1920x1080), 30fps. Each composition's duration is timed to its
// warm en-AU voiceover (public/audio/cN-vo.mp3); every clip ends clean on its
// payoff line (no logo end-card — the page provides the CTA link).
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="C1-the-number"
        component={C1TheNumber}
        durationInFrames={C1_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ hook: "A" as const }}
      />
      <Composition
        id="C2-money-is-code"
        component={C2TheMoneyIsCode}
        durationInFrames={C2_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="C3-one-laptop"
        component={C3OneLaptop}
        durationInFrames={C3_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="C4-schedule-b"
        component={C4ScheduleB}
        durationInFrames={C4_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="C5-handbook"
        component={C5Handbook}
        durationInFrames={C5_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* Vertical paid-social ads (TikTok / Reels), 1080x1920 @ 30fps.
          Sound-on-first — the VO (public/audio/adN-vo.mp3) carries them,
          with burned-in captions for muted viewing. Each ends on the shared
          dark hook-question end-card (~1.5s hold). */}
      <Composition
        id="AD1-screwed"
        component={Ad1Screwed}
        durationInFrames={AD1_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      <Composition
        id="AD2-commission"
        component={Ad2Commission}
        durationInFrames={AD2_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      <Composition
        id="AD3-pov"
        component={Ad3Pov}
        durationInFrames={AD3_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      <Composition
        id="AD4-zero"
        component={Ad4Zero}
        durationInFrames={AD4_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
    </>
  );
};
