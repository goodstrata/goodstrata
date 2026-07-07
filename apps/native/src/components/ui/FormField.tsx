import { type ComponentProps, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { radius, space, type as t } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

/**
 * Labelled, theme-aware text input for the app's report/intake forms (maintenance
 * reports, grievances, …). Focus lifts the border to the accent; `multiline`
 * gives a taller, top-aligned box.
 */
export function FormField({
  label,
  multiline,
  ...props
}: { label: string; multiline?: boolean } & ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space(2) }}>
      <Text style={{ ...t.label, color: theme.muted }}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={theme.muted}
        selectionColor={theme.accent}
        style={{
          ...t.body,
          color: theme.text,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: focused ? theme.accent : theme.line,
          borderRadius: radius.control,
          paddingHorizontal: space(4),
          paddingVertical: space(3),
          ...(multiline ? { minHeight: 92, textAlignVertical: "top" as const } : null),
        }}
      />
    </View>
  );
}
