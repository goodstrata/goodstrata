import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Button, useTheme } from "../src/components";
import { authClient } from "../src/lib/auth";
import { palette, radius, space, type as t } from "../src/theme/tokens";

type Field = "email" | "password";

export default function SignIn() {
  const router = useRouter();
  const theme = useTheme();
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
