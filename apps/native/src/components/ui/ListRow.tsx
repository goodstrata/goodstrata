import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "./PressableScale";

const LEADING_SIZE = 36;
const DOT_SIZE = 6;

export interface ListRowProps {
  title: string;
  /** Default one line; feeds may opt into two before truncation. */
  titleLines?: number;
  /** Muted second line. */
  subtitle?: string;
  /** Figure, StatusPill, or date text. */
  right?: ReactNode;
  /** Default true when onPress is set. */
  chevron?: boolean;
  onPress?: () => void;
  /** Optional 36pt icon disc, ground accentSoft. */
  leading?: ReactNode;
  /** Deep-link target emphasis; semantic tint, never the only cue. */
  highlighted?: boolean;
  /**
   * 6pt accent dot left of the title, title weight up. Pass a boolean (even
   * false) to reserve the dot slot so the cross-fade on read never shifts
   * the row.
   */
  unread?: boolean;
  /** Hairline under the row, inset to the text column. Skip on the last row of a group. */
  divider?: boolean;
  /** Accessible name for the pressable row. Falls back to the row's text content. */
  accessibilityLabel?: string;
  /** Accessible hint describing what activating the row does (e.g. "Opens finance"). */
  accessibilityHint?: string;
}

export function ListRow({
  title,
  titleLines = 1,
  subtitle,
  right,
  chevron,
  onPress,
  leading,
  highlighted = false,
  unread,
  divider,
  accessibilityLabel,
  accessibilityHint,
}: ListRowProps) {
  const theme = useTheme();
  const showChevron = chevron ?? !!onPress;
  const hasDotSlot = unread !== undefined;

  const dotOpacity = useSharedValue(unread ? 1 : 0);
  useEffect(() => {
    // Status change: single opacity cross-fade, 150ms. Nothing pulses.
    dotOpacity.value = withTiming(unread ? 1 : 0, { duration: 150 });
  }, [unread, dotOpacity]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  const body = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: subtitle ? 56 : 44,
        paddingVertical: space(3),
        paddingHorizontal: highlighted ? space(2) : 0,
        borderRadius: highlighted ? space(2) : 0,
        backgroundColor: highlighted ? theme.accentSoft : "transparent",
      }}
    >
      {leading ? (
        <View
          style={{
            width: LEADING_SIZE,
            height: LEADING_SIZE,
            borderRadius: LEADING_SIZE / 2,
            backgroundColor: theme.accentSoft,
            alignItems: "center",
            justifyContent: "center",
            marginRight: space(3),
          }}
        >
          {leading}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {hasDotSlot ? (
            <Animated.View
              style={[
                {
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  backgroundColor: theme.accent,
                  marginRight: space(2),
                },
                dotStyle,
              ]}
            />
          ) : null}
          <Text
            numberOfLines={titleLines}
            style={{
              ...type.body,
              flexShrink: 1,
              fontFamily: unread ? "PublicSans_600SemiBold" : type.body.fontFamily,
              color: theme.text,
            }}
          >
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ ...type.bodySmall, color: theme.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ marginLeft: space(2) }}>{right}</View> : null}
      {showChevron ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.muted}
          style={{ marginLeft: space(2) }}
        />
      ) : null}
    </View>
  );

  const dividerInset = leading ? LEADING_SIZE + space(3) : 0;
  const withDivider = (
    <View>
      {body}
      {divider ? (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            marginLeft: dividerInset,
            backgroundColor: theme.line,
          }}
        />
      ) : null}
    </View>
  );

  if (!onPress) return withDivider;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {withDivider}
    </PressableScale>
  );
}
