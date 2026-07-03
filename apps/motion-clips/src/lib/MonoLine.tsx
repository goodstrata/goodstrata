import type React from "react";
import { fonts, type Theme } from "../theme";

// A shared "label — figure" row used on the clean-UI scenes (scaled ~2x).
// Public Sans label on the left, IBM Plex Mono tabular figure on the right,
// on a --card surface. `onBand` recolours it for the deep-eucalypt band.
export const MonoLine: React.FC<{
  label: string;
  amount: string;
  theme: Theme;
  strong?: boolean;
  width?: number;
  onBand?: boolean;
  labelColor?: string;
  amountColor?: string;
}> = ({
  label,
  amount,
  theme,
  strong,
  width = 1120,
  onBand = false,
  labelColor,
  amountColor,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 44,
      width,
      padding: "34px 50px",
      background: onBand
        ? `color-mix(in oklch, ${theme.bandBg} 55%, ${theme.card})`
        : theme.card,
      border: `1.5px solid ${onBand ? theme.bandLine : theme.line}`,
      borderRadius: 22,
      boxShadow: onBand
        ? "0 34px 66px -40px rgba(0,0,0,0.5)"
        : "0 34px 66px -40px rgba(15,20,28,0.5)",
    }}
  >
    <span
      style={{
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 46,
        color: labelColor ?? (onBand ? theme.bandInk : theme.ink),
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: fonts.mono,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        fontSize: strong ? 62 : 54,
        color: amountColor ?? (onBand ? theme.bandFig : theme.ink),
      }}
    >
      {amount}
    </span>
  </div>
);
