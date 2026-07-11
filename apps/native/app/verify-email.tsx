import { getSetCookie } from "@better-auth/expo/client";
import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Screen, space, type as t, useTheme } from "../src/components";
import { authClient } from "../src/lib/auth";
import { consumePendingInvite, rememberPendingInvite } from "../src/lib/invites";

export default function VerifyEmail() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    cookie?: string;
    token?: string;
    error?: string;
    invite?: string;
  }>();
  const once = useRef(false);
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Confirming your email…");

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const cookie = typeof params.cookie === "string" ? params.cookie : null;
    const token = typeof params.token === "string" ? params.token : null;
    const invite = typeof params.invite === "string" ? params.invite : null;
    const routeError = typeof params.error === "string" ? params.error : null;

    // Strip credentials from visible router state immediately; never leave a
    // session cookie in navigation history, logs or analytics.
    if (cookie || token || routeError) {
      router.replace(invite ? { pathname: "/verify-email", params: { invite } } : "/verify-email");
    }

    void (async () => {
      try {
        if (routeError) throw new Error("That verification link is invalid or has expired.");
        if (invite) await rememberPendingInvite(invite);
        if (cookie) {
          const previous = await SecureStore.getItemAsync("goodstrata_cookie");
          await SecureStore.setItemAsync(
            "goodstrata_cookie",
            getSetCookie(cookie, previous ?? undefined),
          );
          authClient.$store.notify("$sessionSignal");
        } else if (token) {
          const result = await authClient.verifyEmail({ query: { token } });
          if (result.error) throw new Error(result.error.message ?? "Email verification failed.");
        }
        await authClient.getSession();
        const accepted = await consumePendingInvite(invite).catch(() => null);
        setStatus("done");
        setMessage(
          accepted
            ? "Email confirmed. Your building is ready."
            : "Email confirmed. You're ready to continue.",
        );
        setTimeout(
          () => router.replace(accepted ? `/scheme/${accepted.schemeId}` : "/(tabs)"),
          500,
        );
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Email verification failed.");
      }
    })();
  }, [params.cookie, params.error, params.invite, params.token]);

  return (
    <Screen title={status === "error" ? "Verification unavailable" : "Confirming your email"}>
      <Card>
        <Text style={[t.body, { color: status === "error" ? theme.crit : theme.text }]}>
          {message}
        </Text>
        {status === "error" ? (
          <View style={{ marginTop: space(4) }}>
            <Button full label="Back to sign in" onPress={() => router.replace("/sign-in")} />
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
