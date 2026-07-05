import * as Haptics from "expo-haptics";
import { ReactNode, useCallback } from "react";
import { GestureResponderEvent, Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, "style"> {
  /**
   * Selection haptic on pressIn (fire-and-forget). Default FALSE — browsing
   * (cards, rows, nav links) stays quiet per the HIG; opt in only for
   * consequential acts (approve/decline, sign-in, mark-all-read).
   */
  haptic?: boolean;
  /** Scale on press. Default 0.97. */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * The signature tactile feel — every tappable card, row and button routes
 * through this. Spring scale on pressIn (when opted in, the haptic fires
 * then, not on release); with reduce-motion the scale becomes an opacity
 * dip. Do not reimplement this locally.
 */
export function PressableScale({
  haptic = false,
  scaleTo = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  style,
  children,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const dim = useSharedValue(1);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (reduceMotion) {
        dim.value = withTiming(0.7, { duration: 100 });
      } else {
        scale.value = withSpring(scaleTo, { damping: 20, stiffness: 300 });
      }
      if (haptic) {
        Haptics.selectionAsync().catch(() => {
          /* fire-and-forget */
        });
      }
      onPressIn?.(e);
    },
    [reduceMotion, haptic, scaleTo, scale, dim, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (reduceMotion) {
        dim.value = withTiming(1, { duration: 100 });
      } else {
        scale.value = withSpring(1, { damping: 20, stiffness: 300 });
      }
      onPressOut?.(e);
    },
    [reduceMotion, scale, dim, onPressOut],
  );

  const animatedStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: scale.value }],
      opacity: disabled ? 0.45 : dim.value,
    }),
    [disabled],
  );

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
