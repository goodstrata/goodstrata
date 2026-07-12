import { useMemo } from "react";

/**
 * A quiet skyscraper whose windows light themselves on and off in a staggered
 * rhythm — the visual for "the building runs itself". Pure SVG + CSS, eucalypt
 * glow, muted structure. Under prefers-reduced-motion the twinkle stops and it
 * settles into a calm, partly-lit pattern so it's never distracting or
 * inaccessible. Decorative only (aria-hidden).
 */
export function SelfRunningBuilding({ className }: { className?: string }) {
  const windows = useMemo(() => {
    const COLS = 4;
    const ROWS = 12;
    const CELL_W = 9.5;
    const CELL_H = 8.5;
    const WIN_W = 6;
    const WIN_H = 5;
    const ORIGIN_X = 51;
    const ORIGIN_Y = 40;
    const list: { x: number; y: number; delay: number; dur: number }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        // Deterministic scatter (no Math.random) so every render is identical
        // and the lights read as autonomous rather than uniform.
        const h = (i * 2654435761) >>> 0;
        list.push({
          x: ORIGIN_X + c * CELL_W,
          y: ORIGIN_Y + r * CELL_H,
          delay: ((h % 1000) / 1000) * 7,
          dur: 3.4 + (((h >> 10) % 1000) / 1000) * 3,
        });
      }
    }
    return { list, WIN_W, WIN_H };
  }, []);

  return (
    <svg
      viewBox="0 0 140 168"
      role="presentation"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <style>{`
        .srb-win { fill: var(--primary); opacity: 0.1; }
        @media (prefers-reduced-motion: no-preference) {
          .srb-win { animation: srb-glow var(--srb-dur) ease-in-out var(--srb-delay) infinite; }
        }
        @media (prefers-reduced-motion: reduce) {
          .srb-win:nth-child(4n + 1) { opacity: 0.7; }
          .srb-win:nth-child(7n + 3) { opacity: 0.45; }
        }
        @keyframes srb-glow {
          0%, 100% { opacity: 0.08; }
          46%, 54% { opacity: 0.82; }
        }
      `}</style>

      {/* ground line */}
      <line
        x1="18"
        y1="152"
        x2="122"
        y2="152"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
      />

      {/* tower body */}
      <rect
        x="46"
        y="34"
        width="48"
        height="118"
        rx="1.5"
        fill="currentColor"
        fillOpacity="0.04"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
      />
      {/* stepped crown + antenna */}
      <path
        d="M58 34 v-9 h24 v9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
      />
      <line
        x1="70"
        y1="25"
        x2="70"
        y2="12"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
      />
      <circle
        cx="70"
        cy="11"
        r="1.4"
        className="srb-win"
        style={{ ["--srb-delay" as string]: "0.4s", ["--srb-dur" as string]: "3s" }}
      />

      {windows.list.map((w, i) => (
        <rect
          key={i}
          className="srb-win"
          x={w.x}
          y={w.y}
          width={windows.WIN_W}
          height={windows.WIN_H}
          rx="0.8"
          style={{ ["--srb-delay" as string]: `${w.delay}s`, ["--srb-dur" as string]: `${w.dur}s` }}
        />
      ))}
    </svg>
  );
}
