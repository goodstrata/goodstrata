// Manual jest mock for react-native-reanimated v4. The library's own mock still
// imports the native worklets TurboModule (unavailable under jest), so we stub
// the surface the app uses: Animated.* render as plain RN views, layout
// animations are chainable no-ops, and hooks return inert values.
const React = require("react");
const { View, Text, Image, ScrollView } = require("react-native");

// Chainable no-op: FadeInDown.springify().damping(15).delay(120).withInitialValues({}) → itself.
const chainable = new Proxy(function () {}, {
  get: () => chainable,
  apply: () => chainable,
});

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  createAnimatedComponent: (Component) => Component,
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,

  // Layout animation presets (all chainable no-ops).
  FadeIn: chainable,
  FadeOut: chainable,
  FadeInDown: chainable,
  FadeInUp: chainable,
  FadeOutDown: chainable,
  FadeOutUp: chainable,
  SlideInDown: chainable,
  SlideOutDown: chainable,
  Layout: chainable,
  LinearTransition: chainable,

  // Hooks.
  useSharedValue: (initial) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  useDerivedValue: (fn) => ({ value: typeof fn === "function" ? fn() : undefined }),
  useAnimatedScrollHandler: () => () => {},
  useAnimatedRef: () => React.createRef(),
  useReducedMotion: () => false,

  // Animation drivers (return the target value synchronously).
  withTiming: (v) => v,
  withSpring: (v) => v,
  withDelay: (_, v) => v,
  withRepeat: (v) => v,
  withSequence: (v) => v,
  cancelAnimation: () => {},

  interpolate: () => 0,
  interpolateColor: () => "#000000",
  Extrapolation: { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" },
  Easing: new Proxy({}, { get: () => () => 0 }),

  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
};
