import type React from "react";
import { fonts, type Theme } from "../theme";

// An append-only audit log — hash-stamped monospace rows on a --card surface
// (C2 sc.7, C3 sc.5). Deterministic FNV-1a hash per row (stable across frames).
// `visible` reveals rows one by one; `scroll` slides the stack (append motion).
const EVENTS = [
  "levy.apportioned",
  "arrears.notice.sent",
  "repair.reported",
  "repair.dispatched",
  "quote.approved",
  "minutes.drafted",
  "budget.reconciled",
  "insurance.renewed",
  "vote.recorded",
  "payment.received",
  "ledger.closed",
  "agenda.published",
];

const hash8 = (seed: string): string => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 8);
};

export const AuditLog: React.FC<{
  theme: Theme;
  visible: number; // how many rows have appended
  scroll?: number; // px offset (negative slides up)
  band?: boolean;
  width?: number;
  rowCount?: number;
}> = ({ theme, visible, scroll = 0, band = false, width = 1180, rowCount = 9 }) => {
  const surface = band
    ? `color-mix(in oklch, ${theme.bandBg} 55%, ${theme.card})`
    : theme.card;
  const border = band ? theme.bandLine : theme.line;
  const ink = band ? theme.bandInk : theme.ink;
  const muted = band ? theme.bandMuted : theme.faintInk;
  const good = band ? theme.bandFig : theme.primary;

  return (
    <div
      style={{
        width,
        background: surface,
        border: `1.5px solid ${border}`,
        borderRadius: 22,
        padding: "28px 16px",
        boxShadow: band
          ? "0 40px 84px -50px rgba(0,0,0,0.55)"
          : "0 40px 84px -50px rgba(15,20,28,0.5)",
        overflow: "hidden",
        height: rowCount * 72,
      }}
    >
      <div style={{ transform: `translateY(${scroll}px)` }}>
        {Array.from({ length: EVENTS.length }).map((_, i) => {
          const on = i < visible;
          const newest = i === visible - 1;
          const evt = EVENTS[i % EVENTS.length];
          const id = String(4200 + i * 7).padStart(5, "0");
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed log rows
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "0 30px",
                height: 72,
                opacity: on ? 1 : 0.12,
                fontFamily: fonts.mono,
                fontSize: 28,
                borderBottom: `1px solid ${border}`,
                background: newest
                  ? `color-mix(in oklch, ${good} 14%, transparent)`
                  : "transparent",
              }}
            >
              <span style={{ color: muted, width: 90 }}>#{id}</span>
              <span style={{ color: good }}>✓</span>
              <span style={{ color: ink, flex: 1 }}>{evt}</span>
              <span style={{ color: muted, letterSpacing: "0.02em" }}>
                {hash8(`${evt}-${i}`)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
