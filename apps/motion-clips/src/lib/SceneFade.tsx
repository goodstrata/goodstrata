import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneFade } from "./anim";

// Per-scene fade wrapper — eases each scene in over the root so the hard
// Sequence cuts read as gentle dissolves (premium transitions, not cuts).
// Extracted from C1 so every clip shares the exact same transition grammar.
export const SceneFade: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneFade(frame, durationInFrames);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
