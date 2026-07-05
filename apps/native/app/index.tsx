import { Redirect } from "expo-router";
import { View } from "react-native";
import { authClient } from "../src/lib/auth";
import { useTheme } from "../src/theme/useTheme";

export default function Gate() {
  const theme = useTheme();
  const { data: session, isPending } = authClient.useSession();
  if (isPending) {
    // Sub-second session check: a themed ground is enough — no spinner
    // (skeletons-not-spinners holds even here).
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  return session ? <Redirect href="/(tabs)" /> : <Redirect href="/sign-in" />;
}
