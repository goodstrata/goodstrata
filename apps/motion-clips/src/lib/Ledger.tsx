import type React from "react";
import { fonts, type Theme } from "../theme";

// A small reconciling ledger card — debits/credits over a ruled body, then a
// bold balance line that settles to $0.00 (C2 sc.5, C3 sc.2, C4 sc.7).
// `settle` (0..1) fades + un-blurs the balance row so it lands on the VO beat.
export const Ledger: React.FC<{
  theme: Theme;
  rows: [string, string][];
  balanceLabel: string;
  balanceAmount: string;
  settle?: number;
  band?: boolean;
  width?: number;
  title?: string;
}> = ({
  theme,
  rows,
  balanceLabel,
  balanceAmount,
  settle = 1,
  band = false,
  width = 1080,
  title,
}) => {
  const surface = band
    ? `color-mix(in oklch, ${theme.bandBg} 55%, ${theme.card})`
    : theme.card;
  const border = band ? theme.bandLine : theme.line;
  const ink = band ? theme.bandInk : theme.ink;
  const muted = band ? theme.bandMuted : theme.mutedInk;
  const fig = band ? theme.bandFig : theme.ink;
  const good = band ? theme.bandFig : theme.primary;

  return (
    <div
      style={{
        width,
        background: surface,
        border: `1.5px solid ${border}`,
        borderRadius: 22,
        padding: "36px 46px 40px",
        boxShadow: band
          ? "0 40px 84px -50px rgba(0,0,0,0.55)"
          : "0 40px 84px -50px rgba(15,20,28,0.5)",
        textAlign: "left",
      }}
    >
      {title ? (
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: muted,
            marginBottom: 22,
          }}
        >
          {title}
        </div>
      ) : null}
      {rows.map(([label, amt]) => (
        <div
          key={label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 30,
            padding: "16px 0",
            borderBottom: `1.5px solid ${border}`,
            fontFamily: fonts.sans,
            fontSize: 32,
            color: muted,
          }}
        >
          <span>{label}</span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontVariantNumeric: "tabular-nums",
              color: fig,
            }}
          >
            {amt}
          </span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 30,
          marginTop: 26,
          opacity: 0.25 + settle * 0.75,
          filter: `blur(${(1 - settle) * 6}px)`,
        }}
      >
        <span
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 40,
            color: ink,
          }}
        >
          {balanceLabel}
        </span>
        <span
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 64,
            letterSpacing: "-0.01em",
            color: good,
          }}
        >
          {balanceAmount}
        </span>
      </div>
    </div>
  );
};
