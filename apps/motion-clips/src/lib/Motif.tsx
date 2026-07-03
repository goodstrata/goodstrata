import type React from "react";
import type { Theme } from "../theme";

// The site's strata signature: three stacked floor plates (from .motif in
// style.css). Rebuilt in code so the end-card carries the real brand mark
// without embedding the 158KB wordmark SVG.
export const Motif: React.FC<{
  theme: Theme;
  unit?: number;
  color?: string;
}> = ({ theme, unit = 1, color }) => {
  const c = color ?? theme.primary;
  const w = 44 * unit;
  const h = 5 * unit;
  const gap = 7 * unit;
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap,
        verticalAlign: "middle",
      }}
    >
      <span
        style={{
          display: "block",
          height: h,
          width: w,
          borderRadius: h,
          background: c,
          marginLeft: 12 * unit,
        }}
      />
      <span
        style={{
          display: "block",
          height: h,
          width: w,
          borderRadius: h,
          background: c,
          marginLeft: 6 * unit,
        }}
      />
      <span
        style={{
          display: "block",
          height: h,
          width: w,
          borderRadius: h,
          background: c,
        }}
      />
    </div>
  );
};
