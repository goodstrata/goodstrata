import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { PressableScale, useTheme } from "../../src/components";

/**
 * Settings stack: native header with back, no title — each screen's large
 * title is the header. Mirrors the scheme stack so the chrome disappears into
 * the page.
 */
export default function SettingsLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: "",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.accent,
        headerBackTitle: "Back",
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen
        name="notifications"
        options={{
          // First screen of this nested stack, so no native back renders —
          // supply one that pops back to the More tab.
          headerLeft: () => (
            <PressableScale
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/more"))}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={{ width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={24} color={theme.accent} />
            </PressableScale>
          ),
        }}
      />
    </Stack>
  );
}
