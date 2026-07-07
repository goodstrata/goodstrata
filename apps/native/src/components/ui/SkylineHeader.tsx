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
import Svg, { Line, Rect } from "react-native-svg";
import { useTheme } from "../../theme/useTheme";

// A quiet skyline whose windows light themselves on and off in a staggered
// rhythm — the mobile echo of the web login's "self-running building" ("the
// building runs itself"). Decorative, calm, sits across the top of every screen
// header. Under reduced motion the twinkle stops and it settles into a static,
// partly-lit pattern. aria-hidden / non-interactive.

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const VIEW_W = 340;
const VIEW_H = 46;
const GROUND_Y = 42;

// [x, width, height] — a modest, uneven skyline that reads as a real cluster.
const BUILDINGS: [number, number, number][] = [
  [22, 30, 34],
  [60, 24, 22],
  [96, 36, 40],
  [144, 26, 28],
  [182, 30, 36],
  [224, 40, 44],
  [276, 26, 30],
  [312, 20, 24],
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
 * lights read as autonomous rather than uniform). ~2 cols × ≤3 rows per tower. */
function buildWindows(): Win[] {
  const wins: Win[] = [];
  let idx = 0;
  for (const [bx, bw, bh] of BUILDINGS) {
    const top = GROUND_Y - bh;
    const cols = 2;
    const rows = Math.min(3, Math.max(2, Math.floor(bh / 12)));
    const cw = bw / cols;
    const ch = bh / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hsh = (idx * 2654435761) >>> 0;
        wins.push({
          x: bx + c * cw + cw * 0.3,
          y: top + r * ch + ch * 0.28,
          w: cw * 0.4,
          h: ch * 0.44,
          delay: ((hsh % 1000) / 1000) * 4.5,
          dur: 3000 + (((hsh >> 10) % 1000) / 1000) * 2600,
        });
        idx++;
      }
    }
  }
  return wins;
}

function GlowWindow({ win, color, reduce }: { win: Win; color: string; reduce: boolean }) {
  const op = useSharedValue(0.07);
  useEffect(() => {
    if (reduce) {
      // calm, partly-lit static pattern
      op.value = ((Math.round(win.x) * 7 + Math.round(win.y) * 3) % 10) < 4 ? 0.42 : 0.12;
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
      rx={0.6}
      fill={color}
      animatedProps={animatedProps}
    />
  );
}

export function SkylineHeader({ height = 38 }: { height?: number }) {
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
      {BUILDINGS.map(([bx, bw, bh], i) => (
        <Rect
          key={i}
          x={bx}
          y={GROUND_Y - bh}
          width={bw}
          height={bh}
          rx={1}
          fill={theme.muted}
          fillOpacity={0.045}
          stroke={theme.muted}
          strokeOpacity={0.14}
          strokeWidth={0.75}
        />
      ))}
      {wins.map((win, i) => (
        <GlowWindow key={i} win={win} color={theme.accent} reduce={reduce} />
      ))}
    </Svg>
  );
}
