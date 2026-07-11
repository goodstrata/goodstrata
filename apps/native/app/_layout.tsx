import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from "@expo-google-fonts/ibm-plex-mono";
import { Newsreader_500Medium, Newsreader_600SemiBold } from "@expo-google-fonts/newsreader";
import {
  PublicSans_400Regular,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
  useFonts,
} from "@expo-google-fonts/public-sans";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { RootErrorBoundary } from "../src/components/ui/RootErrorBoundary";
import { authClient } from "../src/lib/auth";
import { usePushNotifications } from "../src/lib/pushNotifications";
import { hydrateThemePreference, useTheme } from "../src/theme/useTheme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data stays fresh across navigations, so moving between screens
      // doesn't fire a background refetch (which was flashing the pull-to-refresh
      // spinner). Pull-to-refresh + mutation invalidations still refresh on demand.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [themeReady, setThemeReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    PublicSans_400Regular,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  useEffect(() => {
    void hydrateThemePreference().finally(() => setThemeReady(true));
  }, []);
  useEffect(() => {
    if ((fontsLoaded || fontError) && themeReady) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError, themeReady]);
  if ((!fontsLoaded && !fontError) || !themeReady) return null;
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppNavigator />
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}

/** Mounted inside QueryClientProvider so push receipt can refresh the inbox. */
function AppNavigator() {
  const theme = useTheme();
  const { data: session, isPending } = authClient.useSession();
  usePushNotifications();
  if (isPending) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  return (
    <>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="join" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="verify-email" />
        <Stack.Protected guard={!session?.user}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>
        <Stack.Protected guard={!!session?.user}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="scheme" />
          <Stack.Screen name="settings" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
