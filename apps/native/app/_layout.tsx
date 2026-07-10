import {
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
import {
  PublicSans_400Regular,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
  useFonts,
} from "@expo-google-fonts/public-sans";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { RootErrorBoundary } from "../src/components/ui/RootErrorBoundary";
import { usePushNotifications } from "../src/lib/pushNotifications";
import { useTheme } from "../src/theme/useTheme";

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

export default function RootLayout() {
  // Themed ground from the first frame — dark-mode users never see a
  // paper-white flash on launch or between stack transitions.
  const theme = useTheme();
  usePushNotifications();
  const [fontsLoaded] = useFonts({
    PublicSans_400Regular,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}
        />
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}
