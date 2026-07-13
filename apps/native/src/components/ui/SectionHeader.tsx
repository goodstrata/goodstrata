import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

export interface SectionHeaderProps {
  /** Uppercased mono eyebrow — how sections announce themselves everywhere. */
  label: string;
  /** Optional right-aligned accent text action, e.g. "View all". */
  right?: ReactNode;
}

export function SectionHeader({ label, right }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: space(6),
        marginBottom: space(2),
      }}
    >
      <Text accessibilityRole="header" style={[type.eyebrow, { color: theme.muted }]}>
        {label}
      </Text>
      {right ?? null}
    </View>
  );
}
