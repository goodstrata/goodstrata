import type React from "react";
import { Composition } from "remotion";
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
    </>
  );
};
