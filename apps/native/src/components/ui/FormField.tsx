import { type ComponentProps, forwardRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { radius, space, type as t } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

/**
 * Labelled, theme-aware text input for the app's report/intake forms (maintenance
 * reports, grievances, …). Focus lifts the border to the accent; `multiline`
 * gives a taller, top-aligned box.
 */
export type FormFieldProps = { label: string; multiline?: boolean } & ComponentProps<
  typeof TextInput
>;

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, multiline, ...props },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space(2) }}>
      <Text style={{ ...t.label, color: theme.muted }}>{label}</Text>
      <TextInput
        ref={ref}
        {...props}
        multiline={multiline}
        accessibilityLabel={props.accessibilityLabel ?? label}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        placeholderTextColor={theme.muted}
        selectionColor={theme.accent}
        keyboardAppearance={props.keyboardAppearance ?? (theme.dark ? "dark" : "light")}
        style={[
          {
            ...t.body,
            color: theme.text,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: focused ? theme.accent : theme.line,
            borderRadius: radius.control,
            paddingHorizontal: space(4),
            paddingVertical: space(3),
            ...(multiline ? { minHeight: 92, textAlignVertical: "top" as const } : null),
          },
          props.style,
        ]}
      />
    </View>
  );
});
