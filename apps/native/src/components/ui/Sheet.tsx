import { ReactNode, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { radius, space } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

export interface SheetProps {
  visible: boolean;
  /** Backdrop tap and Android back both call this. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Confirm sheet: slides up with withSpring({ damping: 22, stiffness: 280 }),
 * backdrop ink scrim fades in 150ms; dismiss is a 200ms timing down. Under
 * reduce-motion the sheet fades instead of sliding. Content padding
 * space(5) + safe-area bottom.
 */
export function Sheet({ visible, onClose, children }: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  const backdrop = useSharedValue(0);
  const translateY = useSharedValue(windowHeight);
  const sheetOpacity = useSharedValue(reduceMotion ? 0 : 1);

  useEffect(() => {
    if (visible && !mounted) {
      setMounted(true);
      return;
    }
    if (visible && mounted) {
      backdrop.value = withTiming(1, { duration: 150 });
      if (reduceMotion) {
        translateY.value = 0;
        sheetOpacity.value = withTiming(1, { duration: 150 });
      } else {
        sheetOpacity.value = 1;
        translateY.value = withSpring(0, { damping: 22, stiffness: 280 });
      }
    }
    if (!visible && mounted) {
      backdrop.value = withTiming(0, { duration: 150 });
      const finish = (finished?: boolean) => {
        "worklet";
        if (finished) runOnJS(setMounted)(false);
      };
      if (reduceMotion) {
        sheetOpacity.value = withTiming(0, { duration: 200 }, finish);
      } else {
        translateY.value = withTiming(windowHeight, { duration: 200 }, finish);
      }
    }
  }, [visible, mounted, reduceMotion, windowHeight, backdrop, translateY, sheetOpacity]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!mounted) return null;

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }, backdropStyle]}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        <Animated.View
          style={[
            {
              backgroundColor: theme.surface,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              padding: space(5),
              paddingBottom: insets.bottom + space(5),
            },
            sheetStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
