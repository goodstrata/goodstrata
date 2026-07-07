import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";

// Required for the OAuth browser session to hand control back to the app
// cleanly on iOS — without it the redirect can leave the session dangling.
WebBrowser.maybeCompleteAuthSession();
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PressableScale } from "../src/components/ui/PressableScale";
import { SkylineHeader } from "../src/components/ui/SkylineHeader";
import { authClient } from "../src/lib/auth";
import { palette, radius, space, type as t } from "../src/theme/tokens";

type Field = "email" | "password";

// The sign-in is a fixed dark hero: the navy dark-mode ground with eucalypt as
// the accent — matching the website in dark mode. It deliberately does NOT
// follow the system scheme so the brand entrance is always the same.
const BG = palette.night; // #0c1220 deep navy
const SURFACE = palette.nightRaised; // #141c2e
const LINE = palette.nightLine; // #232d42
const TEXT = palette.nightText; // #eef0f4
const MUTED = palette.nightMuted; // #98a2b3
const ACCENT = palette.eucalyptNight; // #2f9d78 — green lifted for the navy ground

const BUTTON_LABEL = {
  fontFamily: t.label.fontFamily,
  fontSize: 16,
  lineHeight: 20,
  letterSpacing: 0.2,
} as const;

export default function SignIn() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  // A shared-value fade-up (not a layout `entering` animation, which can bail
  // the subtree under React 19 concurrent rendering) for the wordmark.
  const logoOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const logoY = useSharedValue(reduceMotion ? 0 : 20);
  useEffect(() => {
    if (reduceMotion) return;
    const timing = { duration: 520, easing: Easing.out(Easing.cubic) };
    logoOpacity.value = withDelay(120, withTiming(1, timing));
    logoY.value = withDelay(120, withTiming(0, timing));
  }, [reduceMotion, logoOpacity, logoY]);
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ translateY: logoY.value }],
  }));
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<Field | null>(null);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setGooglePending(true);
    setError(null);
    // Opens the system browser against the server's Google OAuth flow; the
    // Expo plugin converts the relative callbackURL into a goodstrata:// deep
    // link and completes the session on return.
    const { error: err } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
    });
    setGooglePending(false);
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err.message ?? "Google sign-in didn't complete. Try again.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  }

  async function submit() {
    setPending(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err.message ?? "Sign in failed. Check your details and try again.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  }

  const canSubmit = !!email && !!password && !pending;

  const inputStyle = (field: Field) => ({
    ...t.body,
    color: TEXT,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: focused === field ? ACCENT : LINE,
    borderRadius: radius.control,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar style="light" />
      {/* Wordmark pinned to the top */}
      <Animated.View style={[{ paddingHorizontal: space(6), paddingTop: space(3) }, logoStyle]}>
        <Image
          source={require("../assets/wordmark-on-dark.png")}
          accessibilityRole="image"
          accessibilityLabel="GoodStrata"
          resizeMode="contain"
          // native asset is 1200×252 (≈4.76:1)
          style={{ width: 208, height: 44 }}
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        {/* Self-running skyline — the visual for "the building runs itself",
            sitting just above the inputs, spaced down from the wordmark. */}
        <SkylineHeader height={108} />
        <View
          style={{ paddingHorizontal: space(6), paddingBottom: space(2), marginTop: space(5) }}
        >
          <Text style={{ ...t.display, color: TEXT }}>
            The building runs itself.{"\n"}You stay in charge.
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: space(6),
            paddingTop: space(5),
            paddingBottom: space(10),
            gap: space(3),
          }}
        >
          <Text style={{ ...t.label, color: MUTED }}>Email</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocused("email")}
            onBlur={() => setFocused((f) => (f === "email" ? null : f))}
            onSubmitEditing={() => passwordRef.current?.focus()}
            selectionColor={ACCENT}
            placeholderTextColor={MUTED}
            style={inputStyle("email")}
          />
          <Text style={{ ...t.label, color: MUTED, marginTop: space(2) }}>Password</Text>
          <TextInput
            ref={passwordRef}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocused("password")}
            onBlur={() => setFocused((f) => (f === "password" ? null : f))}
            onSubmitEditing={submit}
            selectionColor={ACCENT}
            placeholderTextColor={MUTED}
            style={inputStyle("password")}
          />
          {error ? (
            <Text style={{ ...t.bodySmall, color: palette.critNight }}>{error}</Text>
          ) : null}
          <View style={{ marginTop: space(3) }}>
            <PressableScale
              onPress={submit}
              disabled={!canSubmit}
              haptic={canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: !canSubmit, busy: pending }}
              style={{
                height: 50,
                borderRadius: radius.control,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.eucalypt,
                opacity: canSubmit ? 1 : 0.45,
              }}
            >
              {pending ? (
                <ActivityIndicator color={palette.white} />
              ) : (
                <Text style={{ ...BUTTON_LABEL, color: palette.white }}>Sign in</Text>
              )}
            </PressableScale>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space(3),
              marginVertical: space(1),
            }}
          >
            <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
            <Text style={{ ...t.label, color: MUTED }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
          </View>
          <PressableScale
            onPress={google}
            disabled={pending}
            haptic={!pending}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{ disabled: pending, busy: googlePending }}
            style={{
              height: 50,
              borderRadius: radius.control,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: SURFACE,
              borderWidth: 1,
              borderColor: LINE,
            }}
          >
            {googlePending ? (
              <ActivityIndicator color={MUTED} />
            ) : (
              <Text style={{ ...BUTTON_LABEL, color: TEXT }}>Continue with Google</Text>
            )}
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
