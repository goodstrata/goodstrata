import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";
import { Button } from "./Button";

export interface ErrorStateProps {
  /** Default "Couldn't load this". */
  title?: string;
  /** Plain words about what happened and what to do next. */
  detail?: string;
  /** Wire to the React Query refetch. */
  onRetry: () => void;
}

/**
 * Recoverable, not alarming — warn tone, not crit. Explains and points
 * forward; nothing apologises, nothing blames.
 */
export function ErrorState({
  title = "Couldn't load this",
  detail = "Check your connection and try again.",
  onRetry,
}: ErrorStateProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ alignItems: "center", paddingVertical: space(12), paddingHorizontal: space(6) }}
    >
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
        <Ionicons name="alert-circle-outline" size={20} color={theme.warn} />
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
      <Text
        style={{
          ...type.bodySmall,
          color: theme.muted,
          textAlign: "center",
          marginTop: space(1),
        }}
      >
        {detail}
      </Text>
      <View style={{ marginTop: space(4) }}>
        <Button variant="secondary" label="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}
