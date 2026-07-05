import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "./PressableScale";

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One sentence max. No exclamation marks, never "Oops". */
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * An empty register is an invitation to act. Quiet accent text action —
 * not a filled button.
 */
export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: space(12), paddingHorizontal: space(6) }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.disc,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: space(3),
        }}
      >
        <Ionicons name={icon} size={20} color={theme.muted} />
      </View>
      <Text
        style={{
          ...type.body,
          fontFamily: "PublicSans_600SemiBold",
          color: theme.text,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            ...type.bodySmall,
            color: theme.muted,
            textAlign: "center",
            marginTop: space(1),
          }}
        >
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <PressableScale
          onPress={onAction}
          accessibilityRole="button"
          style={{
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: space(3),
            marginTop: space(1),
          }}
        >
          <Text
            style={{
              fontFamily: type.label.fontFamily,
              fontSize: 15,
              lineHeight: 20,
              letterSpacing: 0.2,
              color: theme.accent,
            }}
          >
            {actionLabel}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
