import { Text } from "react-native";
import { formatMoney, formatMoneyLabel } from "../../lib/format";
import { type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

export interface FigureProps {
  /** Integer cents ONLY — never float dollars. */
  cents: number;
  /** hero: 34/40; regular: type.figure (22); small: type.figureSmall (15). */
  size?: "hero" | "regular" | "small";
  /** Default follows sign (negative → crit); explicit tone overrides. */
  tone?: "default" | "ok" | "crit";
  /** Leading + on positive amounts. */
  signed?: boolean;
}

/**
 * Money is the hero. Dollars at full size, cents de-emphasised at 0.6× in
 * muted, same baseline, tabular numerals. Negatives use true minus U+2212.
 * A Figure is never animated, counted up, or transitioned — it appears at
 * its final value, always. A balance is a fact; facts don't move.
 */
export function Figure({ cents, size = "regular", tone = "default", signed }: FigureProps) {
  const theme = useTheme();
  const { dollars, cents: centsPart } = formatMoney(cents);
  const sizeStyle =
    size === "hero" ? type.figureHero : size === "small" ? type.figureSmall : type.figure;
  const colour =
    tone === "ok"
      ? theme.ok
      : tone === "crit"
        ? theme.crit
        : cents < 0
          ? theme.crit
          : theme.text;
  const sign = signed && cents > 0 ? "+" : "";

  return (
    <Text
      accessibilityLabel={formatMoneyLabel(cents)}
      style={[sizeStyle, { color: colour, fontVariant: ["tabular-nums"] }]}
    >
      {sign}
      {dollars}
      <Text
        style={[
          sizeStyle,
          {
            fontSize: Math.round(sizeStyle.fontSize * 0.6),
            color: theme.muted,
            fontVariant: ["tabular-nums"],
          },
        ]}
      >
        {centsPart}
      </Text>
    </Text>
  );
}
