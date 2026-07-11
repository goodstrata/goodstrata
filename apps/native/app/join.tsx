import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  ErrorState,
  FormField,
  humanise,
  Screen,
  Skeleton,
  space,
  type as t,
  useTheme,
} from "../src/components";
import { apiPost } from "../src/lib/api";
import { authClient } from "../src/lib/auth";
import { API_ORIGIN } from "../src/lib/config";
import { rememberPendingInvite } from "../src/lib/invites";

interface InvitePreview {
  schemeName: string;
  role: string;
  email: string;
  name: string | null;
}

export default function Join() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setLoadError("This invite link is incomplete.");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(
        `${API_ORIGIN}/api/invites/preview?token=${encodeURIComponent(token)}`,
      );
      if (!response.ok) throw new Error("This invite is invalid or has expired.");
      const next = (await response.json()) as InvitePreview;
      setPreview(next);
      setName(next.name ?? "");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "This invite is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await apiPost<{ schemeId: string }>("/api/invites/accept", { token });
      router.replace(`/scheme/${result.schemeId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't accept this invite.");
      setPending(false);
    }
  };

  const createAccount = async () => {
    if (!preview) return;
    setPending(true);
    setError(null);
    await rememberPendingInvite(token);
    const result = await authClient.signUp.email({
      email: preview.email,
      password,
      name: preview.name?.trim() || name.trim() || preview.email.split("@")[0] || "Owner",
      callbackURL: Linking.createURL("/verify-email", { queryParams: { invite: token } }),
    });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Couldn't create your account.");
      return;
    }
    if (result.data?.token) {
      await accept();
    } else {
      setPending(false);
      setNeedsVerification(true);
    }
  };

  if (sessionPending || loading) {
    return (
      <Screen title="Your invitation">
        <Card>
          <Skeleton width="70%" height={20} />
          <View style={{ marginTop: space(3) }}>
            <Skeleton width="90%" height={14} />
          </View>
        </Card>
      </Screen>
    );
  }

  if (loadError || !preview) {
    return (
      <Screen title="Invite unavailable">
        <ErrorState detail={loadError ?? undefined} onRetry={load} />
      </Screen>
    );
  }

  if (needsVerification) {
    return (
      <Screen title="Check your email" eyebrow={preview.schemeName}>
        <Card>
          <Text style={[t.body, { color: theme.text }]}>Your account is set up.</Text>
          <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
            Open the verification link sent to {preview.email}. This invite will be accepted when
            you return.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title={`Join ${preview.schemeName}`} eyebrow={humanise(preview.role)}>
      <Card>
        <Text style={[t.bodySmall, { color: theme.muted, marginBottom: space(4) }]}>
          This invitation is for {preview.email}.
        </Text>
        {session?.user ? (
          <View style={{ gap: space(3) }}>
            <Text style={[t.body, { color: theme.text }]}>
              You're signed in as {session.user.email}.
            </Text>
            {error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{error}</Text> : null}
            <Button full label="Accept invite" onPress={accept} pending={pending} />
          </View>
        ) : (
          <View style={{ gap: space(3) }}>
            <FormField
              label="Name"
              value={preview.name ?? name}
              onChangeText={setName}
              editable={!preview.name}
              autoComplete="name"
              textContentType="name"
            />
            <FormField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={createAccount}
            />
            <Text style={[t.caption, { color: theme.muted }]}>At least 8 characters.</Text>
            {error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{error}</Text> : null}
            <Button
              full
              label="Create account and join"
              onPress={createAccount}
              pending={pending}
              disabled={password.length < 8 || (!preview.name && !name.trim())}
            />
            <Button
              variant="secondary"
              full
              label="I already have an account"
              onPress={async () => {
                await rememberPendingInvite(token);
                router.push("/sign-in");
              }}
            />
          </View>
        )}
      </Card>
    </Screen>
  );
}
