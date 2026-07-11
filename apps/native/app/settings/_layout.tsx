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
        // Each settings URL can be the first screen mounted in this nested
        // stack, so Expo may have no automatic back item to draw. Always take
        // the user back to More (or pop when the parent stack is available).
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
  );
}
