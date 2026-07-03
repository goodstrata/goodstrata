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
        width: 780,
        background: theme.card,
        border: `1px solid ${theme.line}`,
        borderRadius: 8,
        padding: "40px 44px 44px",
        boxShadow: "0 40px 80px -50px rgba(15,20,28,0.6)",
        transform: "rotate(-1.4deg)",
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 15,
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
          fontSize: 34,
          letterSpacing: "-0.02em",
          color: theme.ink,
          marginTop: 10,
        }}
      >
        Annual General Meeting
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 20,
          color: theme.mutedInk,
          marginTop: 2,
        }}
      >
        Statement of Fees &amp; Charges
      </div>
      <div
        style={{
          marginTop: 22,
          borderTop: `1px solid ${theme.line}`,
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
                gap: 20,
                padding: "11px 0",
                borderBottom: `1px solid ${theme.line}`,
                fontFamily: fonts.sans,
                fontSize: 18,
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
