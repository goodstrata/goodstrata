import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  ListRow,
  Screen,
  SectionHeader,
  Skeleton,
  space,
  type as t,
  useTheme,
} from "../../src/components";
import { authClient } from "../../src/lib/auth";

const SITE = "https://goodstrata.com.au";

/** Quiet "opens elsewhere" affordance for rows that leave the app. */
function OpenIcon() {
  const theme = useTheme();
  return <Ionicons name="open-outline" size={16} color={theme.muted} />;
}

export default function More() {
  const router = useRouter();
  const theme = useTheme();
  const { data: session, isPending } = authClient.useSession();

  const open = (url: string) => {
    Linking.openURL(url).catch(() => {
      // The device declined the URL; the row simply settles back.
    });
  };

  return (
    <Screen title="More">
      <Card>
        {isPending ? (
          <View style={{ gap: space(2) }}>
            <Skeleton width="45%" height={16} />
            <Skeleton width="65%" height={12} />
          </View>
        ) : (
          <>
            <Text
              style={[t.body, { fontFamily: "PublicSans_600SemiBold", color: theme.text }]}
            >
              {session?.user?.name || "Owner"}
            </Text>
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
              {session?.user?.email ?? ""}
            </Text>
          </>
        )}
      </Card>

      <SectionHeader label="Preferences" />
      <Card padded={false} style={{ paddingHorizontal: space(4) }}>
        <ListRow
          title="Notifications"
          subtitle="Choose what reaches you, and how"
          leading={<Ionicons name="notifications-outline" size={18} color={theme.accent} />}
          chevron
          onPress={() => router.push("/settings/notifications")}
        />
      </Card>

      <SectionHeader label="About" />
      <Card padded={false} style={{ paddingHorizontal: space(4) }}>
        <ListRow
          title="Help and support"
          subtitle="goodstrata.com.au"
          leading={<Ionicons name="help-buoy-outline" size={18} color={theme.accent} />}
          chevron={false}
          right={<OpenIcon />}
          onPress={() => open(`${SITE}/for-owners/`)}
          divider
        />
        <ListRow
          title="Terms of service"
          leading={<Ionicons name="document-text-outline" size={18} color={theme.accent} />}
          chevron={false}
          right={<OpenIcon />}
          onPress={() => open(`${SITE}/terms/`)}
          divider
        />
        <ListRow
          title="Privacy policy"
          leading={<Ionicons name="shield-checkmark-outline" size={18} color={theme.accent} />}
          chevron={false}
          right={<OpenIcon />}
          onPress={() => open(`${SITE}/privacy/`)}
        />
      </Card>

      <View style={{ marginTop: space(6) }}>
        <Button
          variant="secondary"
          full
          label="Sign out"
          onPress={async () => {
            await authClient.signOut();
            router.replace("/sign-in");
          }}
        />
      </View>

      <Text
        style={[
          t.caption,
          { color: theme.muted, textAlign: "center", marginTop: space(6) },
        ]}
      >
        GoodStrata {Constants.expoConfig?.version ?? "0.1.0"}
      </Text>
    </Screen>
  );
}
