import { useEffect } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "../../theme/useTheme";

export interface SkeletonProps {
  width?: number | `${number}%`;
  /** Default 16. */
  height?: number;
  /** Default 6. */
  radius?: number;
}

/**
 * Loading block: a calm opacity pulse (0.55 → 1 → 0.55, 1100ms), not a
 * moving gradient band. Static at 0.7 under reduce-motion. Compose
 * per-screen skeletons matching the real layout's shape — never a spinner
 * for initial screen loads.
 */
export function Skeleton({ width = "100%", height = 16, radius = 6 }: SkeletonProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 0.7 : 0.55);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.7;
      return;
    }
    opacity.value = 0.55;
    opacity.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.skeletonBase },
        animatedStyle,
      ]}
    />
  );
}
