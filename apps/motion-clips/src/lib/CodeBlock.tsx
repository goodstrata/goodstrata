import type React from "react";
import { fonts, type Theme } from "../theme";

// A monospaced code card with light token colouring — the "the money is code"
// motif (C2 sc.4, C3 sc.7). Deterministic tokeniser (keywords / numbers /
// strings / comments) so frames are stable. `reveal` (0..1) drives an optional
// typewriter reveal by character count.
const KEYWORDS = new Set([
  "def",
  "return",
  "for",
  "in",
  "if",
  "assert",
  "function",
  "const",
  "let",
  "sum",
  "round",
  "int",
  "raise",
]);

type Tok = { text: string; color: string };

function tokenLine(line: string, theme: Theme, band: boolean): Tok[] {
  const ink = band ? theme.bandInk : theme.ink;
  const kw = band ? theme.bandFig : theme.primary;
  const num = band ? theme.bandFig : theme.accentInk;
  const str = band ? theme.bandMuted : theme.primaryStrong;
  const com = band ? theme.bandMuted : theme.faintInk;

  const commentIdx = line.indexOf("#");
  let code = line;
  let comment = "";
  if (commentIdx >= 0) {
    code = line.slice(0, commentIdx);
    comment = line.slice(commentIdx);
  }
  const out: Tok[] = [];
  // split keeping delimiters (quotes, word boundaries)
  const parts = code.split(/(\s+|[(){}\[\],:=+\-*/.])/);
  for (const p of parts) {
    if (p === "") continue;
    if (/^-?\d[\d_,.]*$/.test(p)) out.push({ text: p, color: num });
    else if (KEYWORDS.has(p)) out.push({ text: p, color: kw });
    else if (/^["'].*["']$/.test(p)) out.push({ text: p, color: str });
    else out.push({ text: p, color: ink });
  }
  if (comment) out.push({ text: comment, color: com });
  return out;
}

export const CodeBlock: React.FC<{
  theme: Theme;
  lines: string[];
  band?: boolean;
  reveal?: number; // 0..1 typewriter; omit/1 = fully shown
  fontSize?: number;
  title?: string;
  width?: number;
}> = ({
  theme,
  lines,
  band = false,
  reveal = 1,
  fontSize = 34,
  title,
  width = 1160,
}) => {
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  const shown = Math.floor(reveal * total);
  let used = 0;

  const surface = band
    ? `color-mix(in oklch, ${theme.bandBg} 62%, ${theme.card})`
    : theme.card;
  const border = band ? theme.bandLine : theme.line;
  const chrome = band ? theme.bandMuted : theme.faintInk;

  return (
    <div
      style={{
        width,
        background: surface,
        border: `1.5px solid ${border}`,
        borderRadius: 22,
        padding: "34px 42px 40px",
        boxShadow: band
          ? "0 40px 84px -50px rgba(0,0,0,0.55)"
          : "0 40px 84px -50px rgba(15,20,28,0.5)",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 26,
        }}
      >
        <span
          style={{ width: 15, height: 15, borderRadius: "50%", background: chrome, opacity: 0.5 }}
        />
        <span
          style={{ width: 15, height: 15, borderRadius: "50%", background: chrome, opacity: 0.35 }}
        />
        <span
          style={{ width: 15, height: 15, borderRadius: "50%", background: chrome, opacity: 0.2 }}
        />
        {title ? (
          <span
            style={{
              marginLeft: 16,
              fontFamily: fonts.mono,
              fontSize: 22,
              letterSpacing: "0.04em",
              color: chrome,
            }}
          >
            {title}
          </span>
        ) : null}
      </div>
      {lines.map((line, li) => {
        const toks = tokenLine(line, theme, band);
        const lineStart = used;
        used += line.length + 1;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static code lines
            key={li}
            style={{
              fontFamily: fonts.mono,
              fontVariantNumeric: "tabular-nums",
              fontSize,
              lineHeight: 1.55,
              whiteSpace: "pre",
              minHeight: fontSize * 1.55,
            }}
          >
            {(() => {
              let col = lineStart;
              return toks.map((t, ti) => {
                const vis = Math.max(0, Math.min(t.text.length, shown - col));
                col += t.text.length;
                if (vis <= 0) return null;
                return (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: static tokens
                    key={ti}
                    style={{ color: t.color, fontWeight: 500 }}
                  >
                    {t.text.slice(0, vis)}
                  </span>
                );
              });
            })()}
          </div>
        );
      })}
    </div>
  );
};
