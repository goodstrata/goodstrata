import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { PressableScale, useTheme } from "../../../src/components";

/**
 * Scheme stack: native header with back, no title — each screen's large
 * Registry title is the header. Ground matches the theme so the chrome
 * disappears into the page.
 */
export default function SchemeLayout() {
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
        name="index"
        options={{
          // The hub is the first screen of this nested stack, so the native
          // back button would not render — supply one that pops the parent.
          headerLeft: () => (
            <PressableScale
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={{
                width: 44,
                height: 44,
                alignItems: "flex-start",
                justifyContent: "center",
              }}
            >
              <Ionicons name="chevron-back" size={24} color={theme.accent} />
            </PressableScale>
          ),
        }}
      />
      <Stack.Screen name="finance" />
      <Stack.Screen name="finance-statement" />
      <Stack.Screen name="finance-admin" />
      <Stack.Screen name="decisions" />
      <Stack.Screen name="meetings" />
      <Stack.Screen name="documents" />
      <Stack.Screen name="records" />
      <Stack.Screen name="maintenance" />
      <Stack.Screen name="building-compliance" />
      <Stack.Screen name="manager" />
      <Stack.Screen name="grievances" />
      <Stack.Screen name="compliance" />
      <Stack.Screen name="people" />
      <Stack.Screen name="lots" />
      <Stack.Screen name="committee" />
      <Stack.Screen name="activity" />
      <Stack.Screen name="community" />
    </Stack>
  );
}
