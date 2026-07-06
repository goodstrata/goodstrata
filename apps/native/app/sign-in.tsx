import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";

// Required for the OAuth browser session to hand control back to the app
// cleanly on iOS — without it the redirect can leave the session dangling.
WebBrowser.maybeCompleteAuthSession();
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import Svg, { Line, Polygon } from "react-native-svg";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Button, useTheme } from "../src/components";
import { authClient } from "../src/lib/auth";
import { palette, radius, space, type as t } from "../src/theme/tokens";

type Field = "email" | "password";

/**
 * The site-header wireframe cube, drawn as a flat isometric mark for the
 * eucalypt sign-in header (a true 3D CSS cube isn't available in RN). Outer
 * hexagon + three inner edges meeting at the front vertex — a soft white line
 * mark on eucalypt.
 */
function LogoCube({ size = 56 }: { size?: number }) {
  const line = { stroke: palette.white, strokeOpacity: 0.55, strokeWidth: 3 } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Polygon points="50,6 89,28 89,72 50,94 11,72 11,28" fill="none" {...line} strokeLinejoin="round" />
      <Line x1={50} y1={50} x2={11} y2={28} {...line} strokeLinecap="round" />
      <Line x1={50} y1={50} x2={89} y2={28} {...line} strokeLinecap="round" />
      <Line x1={50} y1={50} x2={50} y2={94} {...line} strokeLinecap="round" />
    </Svg>
  );
}

export default function SignIn() {
  const router = useRouter();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
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

  const inputStyle = (field: Field) => ({
    ...t.body,
    color: theme.text,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: focused === field ? theme.accent : theme.line,
    borderRadius: radius.control,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  });

  return (
    // The top half is eucalypt in BOTH modes — the status bar must be light
    // regardless of scheme (auto would draw dark icons on dark green).
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.eucalypt }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <View style={{ padding: space(6), paddingBottom: space(4) }}>
          <Animated.View
            entering={
              reduceMotion
                ? undefined
                : FadeInDown.springify()
                    .damping(15)
                    .delay(120)
                    .withInitialValues({ opacity: 0, transform: [{ translateY: 20 }] })
            }
            style={{ marginBottom: space(3) }}
          >
            <LogoCube />
          </Animated.View>
          <Text style={{ ...t.eyebrow, color: palette.eucalyptSoft }}>GOODSTRATA</Text>
          <Text style={{ ...t.display, color: palette.white, marginTop: space(2) }}>
            The building runs itself.{"\n"}You stay in charge.
          </Text>
        </View>
        <View
          style={{
            backgroundColor: theme.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: space(6),
            paddingBottom: space(10),
            gap: space(3),
          }}
        >
          <Text style={{ ...t.label, color: theme.muted }}>Email</Text>
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
            selectionColor={theme.accent}
            style={inputStyle("email")}
          />
          <Text style={{ ...t.label, color: theme.muted, marginTop: space(2) }}>Password</Text>
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
            selectionColor={theme.accent}
            style={inputStyle("password")}
          />
          {error ? (
            <Text style={{ ...t.bodySmall, color: theme.crit }}>{error}</Text>
          ) : null}
          <View style={{ marginTop: space(3) }}>
            <Button
              variant="primary"
              full
              label="Sign in"
              pending={pending}
              disabled={!email || !password}
              onPress={submit}
            />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), marginVertical: space(1) }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
            <Text style={{ ...t.label, color: theme.muted }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
          </View>
          <Button
            variant="secondary"
            full
            label="Continue with Google"
            pending={googlePending}
            disabled={pending}
            onPress={google}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
