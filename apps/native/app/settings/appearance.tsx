import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Text } from "react-native";
import {
  Card,
  ListRow,
  Screen,
  SectionHeader,
  space,
  type as t,
  useTheme,
} from "../../src/components";
import {
  setThemePreference,
  type ThemePreference,
  useThemePreference,
} from "../../src/theme/useTheme";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  help: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    value: "system",
    label: "Use device setting",
    help: "Follow this phone's light or dark appearance",
    icon: "phone-portrait-outline",
  },
  {
    value: "light",
    label: "Light",
    help: "Paper ground with eucalypt accents",
    icon: "sunny-outline",
  },
  {
    value: "dark",
    label: "Dark",
    help: "Night ground with mint accents",
    icon: "moon-outline",
  },
];

export default function AppearanceSettings() {
  const theme = useTheme();
  const preference = useThemePreference();
  const [pending, setPending] = useState<ThemePreference | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: ThemePreference) => {
    if (next === preference || pending) return;
    const previous = preference;
    setPending(next);
    setError(null);
    try {
      await setThemePreference(next);
    } catch {
      // setThemePreference updates in memory before persisting. Restore the
      // previous selection if SecureStore rejected the write.
      try {
        await setThemePreference(previous);
      } catch {
        // The in-memory value is restored before this second write is tried.
      }
      setError("Couldn't save that appearance. Try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <Screen title="Appearance" topInset={false}>
      <Text style={[t.bodySmall, { color: theme.muted }]}>
        Choose how The Registry looks on this phone. The setting is kept on this device.
      </Text>

      <SectionHeader label="Theme" />
      <Card padded={false} style={{ paddingHorizontal: space(4) }}>
        {OPTIONS.map((option, index) => {
          const selected = option.value === preference;
          const isPending = option.value === pending;
          return (
            <ListRow
              key={option.value}
              title={option.label}
              subtitle={option.help}
              divider={index < OPTIONS.length - 1}
              chevron={false}
              leading={<Ionicons name={option.icon} size={18} color={theme.accent} />}
              right={
                <Ionicons
                  name={
                    isPending
                      ? "ellipsis-horizontal"
                      : selected
                        ? "radio-button-on"
                        : "radio-button-off"
                  }
                  size={20}
                  color={selected || isPending ? theme.accent : theme.muted}
                />
              }
              onPress={() => void choose(option.value)}
              accessibilityLabel={`${option.label}${selected ? ", selected" : ""}`}
              accessibilityHint="Sets the app appearance"
            />
          );
        })}
      </Card>
      {error ? (
        <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>{error}</Text>
      ) : null}
    </Screen>
  );
}
