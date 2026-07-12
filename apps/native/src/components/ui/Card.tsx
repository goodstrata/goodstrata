import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { radius, space } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "./PressableScale";

export interface CardProps {
  onPress?: () => void;
  /** Inner padding space(4). Default true. */
  padded?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}

/**
 * Raised surface with hairline border and (light mode only) one whisper
 * shadow. On night the raised colour plus hairline does the work — no
 * shadow. Cards never nest.
 */
export function Card({ onPress, padded = true, style, children }: CardProps) {
  const theme = useTheme();
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      padding: padded ? space(4) : 0,
    },
    !theme.dark && {
      shadowColor: theme.shadow,
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    style,
  ];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} accessibilityRole="button" style={base}>
        {children}
      </PressableScale>
    );
  }
  return <View style={base}>{children}</View>;
}
