import { ReactNode } from "react";
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
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Single quiet icon action, 44pt hit area. */
  headerRight?: ReactNode;
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
  refreshing,
  onRefresh,
  headerRight,
  children,
}: ScreenProps) {
  const theme = useTheme();

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
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space(10) }}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={theme.muted}
              />
            ) : undefined
          }
        >
          <SkylineHeader />
          {header}
          <View style={{ paddingHorizontal: space(5) }}>{children}</View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <SkylineHeader />
          {header}
          <View style={{ flex: 1, paddingHorizontal: space(5) }}>{children}</View>
        </View>
      )}
    </SafeAreaView>
  );
}
