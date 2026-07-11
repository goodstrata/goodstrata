import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, FormField, Screen, space, type as t, useTheme } from "../src/components";
import { authClient } from "../src/lib/auth";

export default function ResetPassword() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const linkError = typeof params.error === "string" ? params.error : "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!token) return;
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Couldn't reset your password. Request a fresh link.");
      return;
    }
    setDone(true);
  };

  if (linkError || !token) {
    return (
      <Screen title="This link has expired">
        <Card>
          <Text style={[t.bodySmall, { color: theme.muted }]}>
            Reset links are single-use and time-limited. Request a fresh one to continue.
          </Text>
          <View style={{ marginTop: space(4) }}>
            <Button
              full
              label="Request a new link"
              onPress={() => router.replace("/forgot-password")}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title={done ? "Password updated" : "Set a new password"}>
      <Card>
        {done ? (
          <>
            <Text style={[t.body, { color: theme.text }]}>Your new password is ready.</Text>
            <View style={{ marginTop: space(4) }}>
              <Button full label="Sign in" onPress={() => router.replace("/sign-in")} />
            </View>
          </>
        ) : (
          <View style={{ gap: space(3) }}>
            <FormField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <FormField
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={submit}
            />
            {error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{error}</Text> : null}
            <Button
              full
              label="Update password"
              onPress={submit}
              pending={pending}
              disabled={password.length < 8 || confirm.length < 8}
            />
          </View>
        )}
      </Card>
    </Screen>
  );
}
