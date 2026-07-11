import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, FormField, Screen, space, type as t, useTheme } from "../src/components";
import { authClient } from "../src/lib/auth";

export default function ForgotPassword() {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await authClient.requestPasswordReset({
      email: email.trim().toLowerCase(),
      // Expo's client does not rewrite redirectTo, so this must be explicit.
      redirectTo: Linking.createURL("/reset-password"),
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Couldn't send the reset email. Try again.");
      return;
    }
    setSent(true);
  };

  return (
    <Screen title="Reset your password">
      <Card>
        {sent ? (
          <>
            <Text style={[t.body, { color: theme.text }]}>Check your inbox.</Text>
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
              If an account exists for that address, a time-limited reset link is on its way.
            </Text>
          </>
        ) : (
          <View style={{ gap: space(3) }}>
            <Text style={[t.bodySmall, { color: theme.muted }]}>
              Enter your email and we'll send you a link to choose a new password.
            </Text>
            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={submit}
            />
            {error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{error}</Text> : null}
            <Button
              full
              label="Send reset link"
              onPress={submit}
              pending={pending}
              disabled={!email.includes("@")}
            />
          </View>
        )}
      </Card>
      <View style={{ marginTop: space(4) }}>
        <Button
          variant="secondary"
          full
          label="Back to sign in"
          onPress={() => router.replace("/sign-in")}
        />
      </View>
    </Screen>
  );
}
