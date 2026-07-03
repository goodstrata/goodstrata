import { interpolate, spring } from "remotion";

// Shared motion grammar (see plan §"Shared production spine"):
//  - UI enters with a 6px rise + fade over ~9 frames, spring settle.
//  - Count-ups ease-out over ~24 frames.
//  - Fee cards drop with a subtle y-overshoot ("thunk").

// 6px rise + fade. `frame` is scene-local, `start` is the enter frame.
export const riseIn = (
  frame: number,
  fps: number,
  start = 0,
  rise = 6,
): { opacity: number; translateY: number } => {
  const local = frame - start;
  const opacity = interpolate(local, [0, 9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const s = spring({
    frame: local,
    fps,
    config: { damping: 200, mass: 0.6, stiffness: 120 },
    durationInFrames: 18,
  });
  const translateY = interpolate(s, [0, 1], [rise, 0]);
  return { opacity, translateY };
};

// Ease-out count-up to `to` over `dur` frames, starting at `start`.
export const countUp = (
  frame: number,
  to: number,
  start: number,
  dur = 24,
): number =>
  interpolate(frame, [start, start + dur], [0, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

// Fee-card drop with a subtle overshoot "thunk". Returns opacity + translateY.
export const dropIn = (
  frame: number,
  fps: number,
  start = 0,
): { opacity: number; translateY: number } => {
  const local = frame - start;
  const opacity = interpolate(local, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const s = spring({
    frame: local,
    fps,
    config: { damping: 12, mass: 0.9, stiffness: 140 },
    durationInFrames: 24,
  });
  const translateY = interpolate(s, [0, 1], [-26, 0]);
  return { opacity, translateY };
};

// Simple clamped fade between two frames.
export const fade = (
  frame: number,
  from: number,
  to: number,
  a = 0,
  b = 1,
): number =>
  interpolate(frame, [from, to], [a, b], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
