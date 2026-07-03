import type React from "react";
import { Composition } from "remotion";
import { C1_DURATION, C1TheNumber } from "./clips/C1TheNumber";

// Build-time only. Registers the C1 "The Number" flagship composition.
// 16:9 master (1920x1080), 30fps, ~28s. 1:1 and 9:16 cuts to follow (§spine).
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
    </>
  );
};
