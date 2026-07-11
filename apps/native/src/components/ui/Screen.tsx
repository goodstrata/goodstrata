import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";
import { SkylineHeader } from "./SkylineHeader";

export interface ScreenProps {
  /** The large title — this IS the header (expo-router header hidden). */
  title: string;
  /** Mono uppercase line above the title, e.g. "PS 543921K · TIER 2". */
  eyebrow?: string;
  /**
   * Reserve the eyebrow's line even while `eyebrow` is undefined, so the
   * title never jumps when an async eyebrow (the registry plate) resolves.
   */
  reserveEyebrow?: boolean;
  /** Default true → ScrollView; false → plain View for FlatList screens. */
  scroll?: boolean;
  /** Keep the top safe-area inset. Set false when a native stack header owns it. */
  topInset?: boolean;
  /** @deprecated Ignored. The pull-to-refresh spinner now tracks a real pull
   * only, so a background refetch on navigation no longer flashes it. */
  refreshing?: boolean;
  /** Runs on pull-to-refresh; the spinner stays up until its promise settles. */
  onRefresh?: () => Promise<unknown>;
  /** Single quiet icon action, 44pt hit area. */
  headerRight?: ReactNode;
  /** Ambient self-lighting skyline band above the title. Opt-in — only the
   * scheme overview uses it; the login screen carries its own. */
  skyline?: boolean;
  children: ReactNode;
}

/**
 * Screen scaffold: safe-area top (tab bar owns bottom), theme ground,
 * eyebrow + display title, content padded space(5) with space(10) bottom
 * clearance. The title paints immediately — loading never blocks the header.
 */
export function Screen({
  title,
  eyebrow,
  reserveEyebrow,
  scroll = true,
  topInset = true,
  onRefresh,
  headerRight,
  skyline = false,
  children,
}: ScreenProps) {
  const theme = useTheme();
  // Track a real pull only — never a background refetch — so the spinner never
  // appears on its own when navigating between screens.
  const [pulling, setPulling] = useState(false);
  const handleRefresh = onRefresh
    ? () => {
        setPulling(true);
        Promise.resolve(onRefresh()).finally(() => setPulling(false));
      }
    : undefined;

  const header = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        paddingHorizontal: space(5),
        paddingTop: space(2),
        marginBottom: space(4),
      }}
    >
      <View style={{ flex: 1 }}>
        {eyebrow || reserveEyebrow ? (
          <Text style={[type.eyebrow, { color: theme.muted, marginBottom: space(1) }]}>
            {eyebrow || " "}
          </Text>
        ) : null}
        <Text style={[type.display, { color: theme.text }]}>{title}</Text>
      </View>
      {headerRight ? (
        <View
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {headerRight}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={topInset ? ["top"] : []} style={{ flex: 1, backgroundColor: theme.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space(10) }}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={pulling}
                onRefresh={handleRefresh}
                tintColor={theme.muted}
              />
            ) : undefined
          }
        >
          {skyline ? <SkylineHeader /> : null}
          {header}
          <View style={{ paddingHorizontal: space(5) }}>{children}</View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {skyline ? <SkylineHeader /> : null}
          {header}
          <View style={{ flex: 1, paddingHorizontal: space(5) }}>{children}</View>
        </View>
      )}
    </SafeAreaView>
  );
}
