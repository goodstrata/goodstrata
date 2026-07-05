import { ReactNode, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, Text, StyleSheet, View, ViewStyle } from "react-native";
import { radius, space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "./PressableScale";

export interface ButtonProps {
  /** Default "primary". Destructive is for the confirming step only. */
  variant?: "primary" | "secondary" | "destructive";
  /** A verb in sentence case: "Approve", "Pay levy", "Try again". */
  label: string;
  onPress: () => void;
  /** Spinner, locked width, disabled — layout never jumps. */
  pending?: boolean;
  disabled?: boolean;
  /** 18pt leading icon. */
  icon?: ReactNode;
  /** Stretch to container width. */
  full?: boolean;
}

export function Button({
  variant = "primary",
  label,
  onPress,
  pending,
  disabled,
  icon,
  full,
}: ButtonProps) {
  const theme = useTheme();
  const [lockedWidth, setLockedWidth] = useState<number>();
  const isDisabled = !!disabled || !!pending;

  const onLayout = (e: LayoutChangeEvent) => {
    if (!pending) setLockedWidth(e.nativeEvent.layout.width);
  };

  const variantStyle: ViewStyle =
    variant === "primary"
      ? { backgroundColor: theme.accentFill }
      : variant === "destructive"
        ? { backgroundColor: theme.critFill }
        : {
            backgroundColor: "transparent",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.line,
          };
  const labelColor = variant === "secondary" ? theme.text : theme.onAccent;
  const spinnerColor = variant === "secondary" ? theme.muted : theme.onAccent;

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      haptic={!isDisabled}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: !!pending }}
      style={[
        {
          height: 50,
          borderRadius: radius.control,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: space(5),
          minWidth: pending ? lockedWidth : undefined,
        },
        variantStyle,
        full ? { alignSelf: "stretch" } : { alignSelf: "flex-start" },
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <>
          {icon ? <View style={{ marginRight: space(2) }}>{icon}</View> : null}
          <Text
            style={{
              fontFamily: type.label.fontFamily,
              fontSize: 16,
              lineHeight: 20,
              letterSpacing: 0.2,
              color: labelColor,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </PressableScale>
  );
}
