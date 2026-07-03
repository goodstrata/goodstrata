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
}> = ({ theme, label, amount, dropAt, tone = "ink", greyed = false }) => {
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
        gap: 24,
        width: 640,
        padding: "20px 28px",
        background: greyed
          ? `color-mix(in oklch, ${theme.card} 78%, ${theme.paper})`
          : theme.card,
        border: `1px solid ${tone === "critical" ? `color-mix(in oklch, ${theme.critical} 40%, ${theme.line})` : theme.line}`,
        borderRadius: 14,
        boxShadow: "0 20px 40px -30px rgba(15,20,28,0.55)",
        opacity: greyed ? opacity * 0.92 : opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fonts.sans,
          fontWeight: 500,
          fontSize: 26,
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
          fontSize: 30,
          color: amountColor,
          fontStyle: greyed ? "italic" : "normal",
        }}
      >
        {amount}
      </span>
    </div>
  );
};
