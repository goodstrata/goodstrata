import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  FormField,
  PressableScale,
  Screen,
  space,
  type as t,
  useTheme,
} from "../src/components";
import { authClient } from "../src/lib/auth";
import { useAuthPageInfo } from "../src/lib/authCapabilities";

export default function SignUp() {
  const theme = useTheme();
  const { data: authInfo } = useAuthPageInfo();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      callbackURL: Linking.createURL("/verify-email"),
    });
    setPending(false);
    if (result.error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(result.error.message ?? "Couldn't create your account. Try again.");
      return;
    }
    if (result.data?.token) {
      router.replace("/(tabs)");
    } else {
      setVerificationEmail(email.trim().toLowerCase());
    }
  };

  const continueWithGoogle = async () => {
    setGooglePending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-up",
    });
    setGooglePending(false);
    if (result.error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(result.error.message ?? "Google sign-up didn't complete. Try again.");
      return;
    }
    router.replace("/(tabs)");
  };

  if (verificationEmail) {
    return (
      <Screen title="Check your email" eyebrow="Account created">
        <Card>
          <Text style={[t.body, { color: theme.text }]}>Confirm your email to continue.</Text>
          <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
            We sent a verification link to {verificationEmail}. Open it on this phone to finish
            signing in.
          </Text>
          <View style={{ marginTop: space(5) }}>
            <Button
              variant="secondary"
              full
              label="Back to sign in"
              onPress={() => router.replace("/sign-in")}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  const valid =
    name.trim().length > 0 &&
    email.includes("@") &&
    password.length >= 8 &&
    consent &&
    !pending &&
    !googlePending;

  return (
    <Screen title="Create your account" eyebrow="The Registry">
      <Card>
        <View style={{ gap: space(3) }}>
          {authInfo?.socialProviders?.includes("google") ? (
            <>
              <Button
                full
                variant="secondary"
                label="Continue with Google"
                icon={<Ionicons name="logo-google" size={18} color={theme.text} />}
                onPress={() => void continueWithGoogle()}
                pending={googlePending}
                disabled={pending}
              />
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: space(3), marginTop: 2 }}
              >
                <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
                <Text style={[t.label, { color: theme.muted }]}>or</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
              </View>
            </>
          ) : null}
          <FormField
            label="Name"
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
          />
          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <FormField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
          />
          <Text style={[t.caption, { color: theme.muted, marginTop: -space(1) }]}>
            At least 8 characters.
          </Text>
          <PressableScale
            onPress={() => setConsent((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            accessibilityLabel="Accept the Terms and Privacy Policy"
            style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3), minHeight: 44 }}
          >
            <Ionicons
              name={consent ? "checkbox" : "square-outline"}
              size={22}
              color={consent ? theme.accent : theme.muted}
            />
            <Text style={[t.bodySmall, { color: theme.muted, flex: 1 }]}>
              I agree to the Terms and Privacy Policy.
            </Text>
          </PressableScale>
          {error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{error}</Text> : null}
          <Button
            full
            label="Create account"
            onPress={submit}
            disabled={!valid}
            pending={pending}
          />
        </View>
      </Card>
      <View style={{ marginTop: space(4) }}>
        <Button
          variant="secondary"
          full
          label="Already have an account? Sign in"
          onPress={() => router.replace("/sign-in")}
        />
      </View>
    </Screen>
  );
}
