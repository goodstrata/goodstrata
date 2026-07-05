import { FadeInDown, useReducedMotion } from "react-native-reanimated";

/**
 * List entrance (§2 rule 2): on FIRST successful load only, items fade in
 * and rise 8pt, staggered 40ms, capped at the first 6 items — items 7+
 * appear instantly. Returns an `entering` value for Animated.View.
 *
 * Pass `enabled=false` after the first load — never re-run on refetch,
 * pull-to-refresh, tab return, or pagination. Reduce-motion disables it
 * entirely.
 *
 *   const entering = useListEntering(isFirstLoad);
 *   <Animated.View entering={entering(index)}>…</Animated.View>
 */
export function useListEntering(enabled: boolean = true) {
  const reduceMotion = useReducedMotion();
  return (index: number) => {
    if (!enabled || reduceMotion || index >= 6) return undefined;
    return FadeInDown.springify()
      .damping(18)
      .delay(index * 40)
      .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
  };
}
