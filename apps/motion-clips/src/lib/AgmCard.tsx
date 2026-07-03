import type React from "react";
import { fonts, type Theme } from "../theme";

// A stylised AGM "Statement of Fees & Charges" document — the deliberate v1
// brand treatment standing in for the sc.1 kitchen-table photo. Dense, real-
// looking figures on a paper card. Structured so a real <Img> can sit behind
// it later (KenBurns `src`).
const rows: [string, string][] = [
  ["Management fee (12 lots × $550)", "$6,600.00"],
  ["Disbursements & sundries", "$1,320.00"],
  ["Committee meeting attendance", "$180.00"],
  ["Annual general meeting", "$300.00"],
  ["Arrears notice (× 6)", "$540.00"],
  ["Photocopying & postage", "$214.80"],
  ["Insurance placement", "undisclosed"],
];

export const AgmCard: React.FC<{ theme: Theme }> = ({ theme }) => {
  return (
    <div
      style={{
        width: 1080,
        background: theme.card,
        border: `1.5px solid ${theme.line}`,
        borderRadius: 14,
        padding: "56px 64px 60px",
        boxShadow: "0 60px 120px -60px rgba(15,20,28,0.6)",
        transform: "rotate(-1.4deg)",
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 22,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: theme.mutedInk,
        }}
      >
        Owners Corporation · Plan of Subdivision
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 50,
          letterSpacing: "-0.02em",
          color: theme.ink,
          marginTop: 14,
        }}
      >
        Annual General Meeting
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 29,
          color: theme.mutedInk,
          marginTop: 4,
        }}
      >
        Statement of Fees &amp; Charges
      </div>
      <div
        style={{
          marginTop: 30,
          borderTop: `1.5px solid ${theme.line}`,
        }}
      >
        {rows.map(([label, amt]) => {
          const undisclosed = amt === "undisclosed";
          return (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 30,
                padding: "16px 0",
                borderBottom: `1.5px solid ${theme.line}`,
                fontFamily: fonts.sans,
                fontSize: 27,
                color: theme.mutedInk,
              }}
            >
              <span>{label}</span>
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontVariantNumeric: "tabular-nums",
                  color: undisclosed ? theme.critical : theme.ink,
                  fontStyle: undisclosed ? "italic" : "normal",
                }}
              >
                {amt}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
