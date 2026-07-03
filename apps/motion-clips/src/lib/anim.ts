import { Easing, interpolate, spring } from "remotion";

// Shared motion grammar (see plan §"Shared production spine"):
//  - UI enters with a rise + fade over ~10 frames, soft spring settle.
//  - Count-ups & transitions use a bezier ease-in-out (premium, not mechanical).
//  - Fee cards drop with a gentle y-overshoot ("thunk").

// A classic ease-in-out bezier reused for count-ups, strikes and transitions.
export const EASE_IN_OUT = Easing.bezier(0.45, 0, 0.25, 1);
// A soft ease-out for entrances (fast to settle, no snap).
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

// Rise + fade. `frame` is scene-local, `start` is the enter frame.
// A soft spring (damping 200) settles the translate with no bounce.
export const riseIn = (
  frame: number,
  fps: number,
  start = 0,
  rise = 16,
): { opacity: number; translateY: number } => {
  const local = frame - start;
  const opacity = interpolate(local, [0, 11], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const s = spring({
    frame: local,
    fps,
    config: { damping: 200, mass: 0.7, stiffness: 120 },
    durationInFrames: 22,
  });
  const translateY = interpolate(s, [0, 1], [rise, 0]);
  return { opacity, translateY };
};

// Ease-in-out count-up to `to` over `dur` frames, starting at `start`.
export const countUp = (
  frame: number,
  to: number,
  start: number,
  dur = 40,
): number =>
  interpolate(frame, [start, start + dur], [0, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });

// Fee-card drop with a gentle overshoot "thunk". Returns opacity + translateY.
export const dropIn = (
  frame: number,
  fps: number,
  start = 0,
): { opacity: number; translateY: number } => {
  const local = frame - start;
  const opacity = interpolate(local, [0, 7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  // damping ~14 keeps a single soft overshoot — a thunk, not a bounce.
  const s = spring({
    frame: local,
    fps,
    config: { damping: 14, mass: 0.85, stiffness: 130 },
    durationInFrames: 28,
  });
  const translateY = interpolate(s, [0, 1], [-44, 0]);
  return { opacity, translateY };
};

// Pattern-interrupt slam for the vertical paid-social hooks: text lands at
// scale with a single hard settle (stiffer spring than dropIn — a slam, not
// a thunk). Opacity resolves in 4 frames so the first readable frame is bold.
export const slamIn = (
  frame: number,
  fps: number,
  start = 0,
): { opacity: number; scale: number } => {
  const local = frame - start;
  const opacity = interpolate(local, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const s = spring({
    frame: local,
    fps,
    config: { damping: 16, mass: 0.6, stiffness: 210 },
    durationInFrames: 16,
  });
  const scale = interpolate(s, [0, 1], [1.22, 1]);
  return { opacity, scale };
};

// Simple clamped fade between two frames (linear by default).
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
    easing: EASE_IN_OUT,
  });

// Per-scene fade — eases each scene in (and optionally out) so the hard
// Sequence cuts read as gentle dissolves over the paper root.
export const sceneFade = (
  frame: number,
  durationInFrames: number,
  inFrames = 11,
  outFrames = 0,
): number => {
  const fin = interpolate(frame, [0, inFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  if (outFrames <= 0) return fin;
  const fout = interpolate(
    frame,
    [durationInFrames - outFrames, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_IN_OUT,
    },
  );
  return fin * fout;
};
