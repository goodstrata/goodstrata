import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { fonts, type Theme } from "../theme";
import { dropIn } from "./anim";

// A fee "brick" that drops with a thunk over the base fee (plan sc.3).
export const FeeCard: React.FC<{
  theme: Theme;
  label: string;
  amount: string;
  dropAt: number; // scene-local frame the card drops
  tone?: "ink" | "critical";
  greyed?: boolean;
  width?: number; // 1120 for the 16:9 cuts; ~900 fits the 9:16 ads
}> = ({ theme, label, amount, dropAt, tone = "ink", greyed = false, width = 1120 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, translateY } = dropIn(frame, fps, dropAt);

  const amountColor = tone === "critical" ? theme.critical : theme.ink;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 44,
        width,
        padding: "34px 50px",
        background: greyed ? `color-mix(in oklch, ${theme.card} 78%, ${theme.paper})` : theme.card,
        border: `1.5px solid ${tone === "critical" ? `color-mix(in oklch, ${theme.critical} 40%, ${theme.line})` : theme.line}`,
        borderRadius: 22,
        boxShadow: "0 34px 66px -40px rgba(15,20,28,0.55)",
        opacity: greyed ? opacity * 0.92 : opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fonts.sans,
          fontWeight: 500,
          fontSize: 46,
          color: greyed ? theme.faintInk : theme.mutedInk,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          fontSize: 54,
          color: amountColor,
          fontStyle: greyed ? "italic" : "normal",
        }}
      >
        {amount}
      </span>
    </div>
  );
};
