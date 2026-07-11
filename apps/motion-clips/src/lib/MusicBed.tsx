import type React from "react";
import { Audio, interpolate, staticFile, useVideoConfig } from "remotion";

// Music bed under the VO: fixed low level with a short fade-in and a longer
// fade-out timed to the composition's end. The beds themselves are original
// synthesized tracks (scripts/make-music.py) mastered to -16 LUFS — `volume`
// sets how far they sit under the -21.5 LUFS narration.
export const MusicBed: React.FC<{
  src: string;
  volume?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}> = ({ src, volume = 0.15, fadeInSec = 0.7, fadeOutSec = 2.0 }) => {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <Audio
      src={staticFile(src)}
      volume={(f) =>
        volume *
        interpolate(
          f,
          [
            0,
            fadeInSec * fps,
            durationInFrames - fadeOutSec * fps,
            durationInFrames - 1,
          ],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      }
    />
  );
};
