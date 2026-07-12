import { useEffect, useMemo } from "react";
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Line, Path, Rect } from "react-native-svg";
import { useTheme } from "../../theme/useTheme";

// A quiet skyline whose windows light themselves on and off in a staggered
// rhythm — the mobile echo of the web login's "self-running building" ("the
// building runs itself"). Decorative, calm, sits across the top of every screen
// header. Under reduced motion the twinkle stops and it settles into a static,
// partly-lit pattern. aria-hidden / non-interactive.

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const VIEW_W = 340;
const VIEW_H = 60;
const GROUND_Y = 56;
// The viewBox keeps ~26px of empty sky above the tallest roof so the
// `xMidYMax slice` crop only ever eats sky, never a rooftop, at any screen
// width. Towers are slim and short so the cluster reads delicate, not looming.

// [x, width, height] — slim towers of uneven height. Tallest tops at y=26.
const BUILDINGS: [number, number, number][] = [
  [26, 26, 26],
  [62, 22, 22],
  [94, 30, 30],
  [136, 24, 24],
  [170, 28, 28],
  [212, 22, 24],
  [248, 30, 30],
  [290, 26, 28],
];

interface Win {
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
  dur: number;
}

/** Deterministic window grid (no Math.random → identical every render, and the
 * lights read as autonomous rather than uniform). Denser than a single column
 * so each tower carries several lights. */
function buildWindows(): Win[] {
  const wins: Win[] = [];
  let idx = 0;
  for (const [bx, bw, bh] of BUILDINGS) {
    const top = GROUND_Y - bh;
    const cols = bw >= 25 ? 3 : 2;
    const rows = 3;
    const cw = bw / cols;
    const ch = bh / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hsh = (idx * 2654435761) >>> 0;
        wins.push({
          x: bx + c * cw + cw * 0.26,
          y: top + r * ch + ch * 0.24,
          w: cw * 0.48,
          h: ch * 0.5,
          // wider stagger + slower cycles read as a calmer, self-running rhythm
          delay: ((hsh % 1000) / 1000) * 6,
          dur: 5000 + (((hsh >> 10) % 1000) / 1000) * 4500,
        });
        idx++;
      }
    }
  }
  return wins;
}

function GlowWindow({ win, color, reduce }: { win: Win; color: string; reduce: boolean }) {
  const op = useSharedValue(0.06);
  useEffect(() => {
    if (reduce) {
      // calm, partly-lit static pattern
      op.value = (Math.round(win.x) * 7 + Math.round(win.y) * 3) % 10 < 4 ? 0.42 : 0.12;
      return;
    }
    op.value = withDelay(
      Math.round(win.delay * 1000),
      withRepeat(
        withTiming(0.5, { duration: Math.round(win.dur), easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
  }, [reduce, op, win.delay, win.dur, win.x, win.y]);
  const animatedProps = useAnimatedProps(() => ({ fillOpacity: op.value }));
  return (
    <AnimatedRect
      x={win.x}
      y={win.y}
      width={win.w}
      height={win.h}
      rx={0.5}
      fill={color}
      animatedProps={animatedProps}
    />
  );
}

export function SkylineHeader({ height = 46 }: { height?: number }) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const wins = useMemo(buildWindows, []);
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMax slice"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Line
        x1={10}
        y1={GROUND_Y}
        x2={VIEW_W - 10}
        y2={GROUND_Y}
        stroke={theme.muted}
        strokeOpacity={0.16}
        strokeWidth={0.75}
      />
      {/* Faint tower bodies — fill only, no stroke. */}
      {BUILDINGS.map(([bx, bw, bh]) => (
        <Rect
          key={`body-${bx}`}
          x={bx}
          y={GROUND_Y - bh}
          width={bw}
          height={bh}
          fill={theme.muted}
          fillOpacity={0.05}
        />
      ))}
      {/* Outline: left + top + right only — no bottom edge, so it never
          doubles up on the shared ground line. */}
      {BUILDINGS.map(([bx, bw, bh]) => (
        <Path
          key={`outline-${bx}`}
          d={`M${bx} ${GROUND_Y} L${bx} ${GROUND_Y - bh} L${bx + bw} ${GROUND_Y - bh} L${bx + bw} ${GROUND_Y}`}
          fill="none"
          stroke={theme.muted}
          strokeOpacity={0.15}
          strokeWidth={0.75}
        />
      ))}
      {wins.map((win) => (
        <GlowWindow
          key={`window-${win.x}-${win.y}`}
          win={win}
          color={theme.accent}
          reduce={reduce}
        />
      ))}
    </Svg>
  );
}
