import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  formatRelativeTime,
  radius,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../src/components";
import { authClient } from "../../src/lib/auth";
import { useAuthPageInfo } from "../../src/lib/authCapabilities";

const SESSIONS_KEY = ["settings-sessions"] as const;
const ACCOUNTS_KEY = ["settings-accounts"] as const;

interface LinkedAccount {
  id: string;
  providerId: string;
}

interface SessionRow {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  expiresAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (/session (is not fresh|expired)/i.test(error.message)) {
    return "For your security, sign out and sign in again before changing this.";
  }
  return error.message;
}

function describeAgent(userAgent: string | null | undefined): {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  if (!userAgent) return { label: "Unknown device", icon: "desktop-outline" };
  const browser = /Edg/.test(userAgent)
    ? "Edge"
    : /OPR|Opera/.test(userAgent)
      ? "Opera"
      : /Chrome/.test(userAgent)
        ? "Chrome"
        : /Firefox/.test(userAgent)
          ? "Firefox"
          : /Safari/.test(userAgent)
            ? "Safari"
            : /GoodStrata|ReactNative|Expo/.test(userAgent)
              ? "GoodStrata"
              : "Browser";
  const os = /iPhone|iPad|iOS/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  const mobile = /iPhone|iPad|Android|Mobile|ReactNative|Expo/.test(userAgent);
  return {
    label: os ? `${browser} on ${os}` : browser,
    icon: mobile ? "phone-portrait-outline" : "desktop-outline",
  };
}

export default function SecuritySettings() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const currentToken = session.data?.session.token;
  const email = session.data?.user.email ?? "";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordLinkSent, setPasswordLinkSent] = useState(false);
  const [passwordLinkPending, setPasswordLinkPending] = useState(false);
  const [passwordLinkError, setPasswordLinkError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) {
        throw new Error(result.error.message ?? "Couldn't load connected accounts.");
      }
      return (result.data ?? []) as LinkedAccount[];
    },
  });

  const authInfoQuery = useAuthPageInfo();

  const sessionsQuery = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(result.error.message ?? "Couldn't load active sessions.");
      return (result.data ?? []) as unknown as SessionRow[];
    },
  });

  const revokeOne = useMutation({
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token });
      if (result.error) throw new Error(result.error.message ?? "Couldn't revoke that session.");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions();
      if (result.error) throw new Error(result.error.message ?? "Couldn't sign out other devices.");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });

  const linkGoogle = useMutation({
    mutationFn: async () => {
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL: "/settings/security",
        errorCallbackURL: "/settings/security",
      });
      if (result.error) throw new Error(result.error.message ?? "Couldn't connect Google.");
    },
    onMutate: () => setAccountError(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
    onError: (error) => setAccountError(errorMessage(error, "Couldn't connect Google.")),
  });

  const unlinkGoogle = useMutation({
    mutationFn: async () => {
      const result = await authClient.unlinkAccount({ providerId: "google" });
      if (result.error) throw new Error(result.error.message ?? "Couldn't disconnect Google.");
    },
    onMutate: () => setAccountError(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
    onError: (error) => setAccountError(errorMessage(error, "Couldn't disconnect Google.")),
  });

  const accounts = accountsQuery.data ?? [];
  // If account discovery fails, retain the current-password form. Better Auth
  // still verifies the password server-side, making this the safe fallback.
  const hasPassword =
    !accountsQuery.isSuccess || accounts.some((account) => account.providerId === "credential");
  const googleLinked = accounts.some((account) => account.providerId === "google");
  const googleConfigured = Boolean(
    authInfoQuery.data?.socialProviders?.includes("google") || googleLinked,
  );
  const hasOtherSignIn = accounts.some((account) => account.providerId !== "google");

  const sendSetPasswordLink = async () => {
    if (!email || passwordLinkPending) return;
    setPasswordLinkPending(true);
    setPasswordLinkError(null);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: Linking.createURL("/reset-password"),
    });
    setPasswordLinkPending(false);
    if (result.error) {
      setPasswordLinkError(result.error.message ?? "Couldn't send the password link.");
      return;
    }
    setPasswordLinkSent(true);
  };

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordSaved(false);
    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Use at least 8 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Choose a password you haven't used here.");
      return;
    }

    setPasswordPending(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message ?? "Couldn't change your password.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      await session.refetch();
    } catch (error) {
      setPasswordError(errorMessage(error, "Couldn't change your password."));
    } finally {
      setPasswordPending(false);
    }
  };

  const deleteAccount = async () => {
    if (deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      const result = await authClient.deleteUser(hasPassword ? { password: deletePassword } : {});
      if (result.error) throw new Error(result.error.message ?? "Couldn't delete your account.");
      await authClient.signOut();
      router.replace("/sign-in");
    } catch (error) {
      setDeleteError(errorMessage(error, "Couldn't delete your account."));
    } finally {
      setDeletePending(false);
    }
  };

  const sessions = sessionsQuery.data ?? [];
  const ordered = [...sessions].sort((a, b) => {
    if (a.token === currentToken) return -1;
    if (b.token === currentToken) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const otherSessions = sessions.filter((item) => item.token !== currentToken);
  const deleteConfirmed =
    deleteEmail.trim().toLowerCase() === email.toLowerCase() &&
    (!hasPassword || deletePassword.length > 0);

  const confirmRevoke = (item: SessionRow) => {
    const { label } = describeAgent(item.userAgent);
    Alert.alert("Sign out this session?", `${label} will need to sign in again.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => revokeOne.mutate(item.token),
      },
    ]);
  };

  const confirmRevokeOthers = () => {
    Alert.alert(
      "Sign out everywhere else?",
      `${otherSessions.length} other ${otherSessions.length === 1 ? "session" : "sessions"} will need to sign in again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => revokeOthers.mutate(),
        },
      ],
    );
  };

  return (
    <Screen
      title="Security"
      topInset={false}
      onRefresh={() => Promise.all([sessionsQuery.refetch(), accountsQuery.refetch()])}
    >
      <Text style={[t.bodySmall, { color: theme.muted }]}>
        Update your password and review every device signed in to your account.
      </Text>

      <SectionHeader label="Password" />
      {accountsQuery.isPending ? (
        <Card>
          <Skeleton width="70%" height={16} />
          <View style={{ marginTop: space(3), gap: space(3) }}>
            <Skeleton width="100%" height={42} />
            <Skeleton width="100%" height={42} />
          </View>
        </Card>
      ) : !hasPassword ? (
        <Card>
          <Text style={[t.body, { color: theme.text }]}>Set a password</Text>
          <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
            This account currently signs in through Google. A password adds a second way in and lets
            you disconnect Google without locking yourself out.
          </Text>
          {passwordLinkSent ? (
            <Text style={[t.bodySmall, { color: theme.info, marginTop: space(3) }]}>
              Check {email}. The time-limited link opens GoodStrata so you can set your password.
            </Text>
          ) : null}
          {passwordLinkError ? (
            <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
              {passwordLinkError}
            </Text>
          ) : null}
          <View style={{ marginTop: space(4) }}>
            <Button
              full
              variant="secondary"
              label={passwordLinkSent ? "Resend password link" : "Email me a password link"}
              onPress={() => void sendSetPasswordLink()}
              pending={passwordLinkPending}
            />
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={[t.bodySmall, { color: theme.muted, marginBottom: space(3) }]}>
            Changing your password signs out every other device as a precaution.
          </Text>
          <View style={{ gap: space(3) }}>
            <FormField
              label="Current password"
              value={currentPassword}
              onChangeText={(value) => {
                setCurrentPassword(value);
                setPasswordError(null);
                setPasswordSaved(false);
              }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="next"
            />
            <FormField
              label="New password"
              value={newPassword}
              onChangeText={(value) => {
                setNewPassword(value);
                setPasswordError(null);
                setPasswordSaved(false);
              }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
            />
            <Text style={[t.caption, { color: theme.muted, marginTop: -space(1) }]}>
              At least 8 characters.
            </Text>
            <FormField
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                setPasswordError(null);
                setPasswordSaved(false);
              }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void changePassword()}
            />
            {passwordError ? (
              <Text style={[t.bodySmall, { color: theme.crit }]}>{passwordError}</Text>
            ) : passwordSaved ? (
              <Text style={[t.bodySmall, { color: theme.ok }]}>
                Password changed. Other devices were signed out.
              </Text>
            ) : null}
            <Button
              full
              label="Change password"
              onPress={() => void changePassword()}
              pending={passwordPending}
              disabled={!currentPassword || !newPassword || !confirmPassword}
            />
          </View>
        </Card>
      )}

      {googleConfigured ? (
        <>
          <SectionHeader label="Connected accounts" />
          <Card>
            {accountsQuery.isError ? (
              <ErrorState
                detail={errorMessage(accountsQuery.error, "Couldn't load connected accounts.")}
                onRetry={() => void accountsQuery.refetch()}
              />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.accentSoft,
                  }}
                >
                  <Ionicons name="logo-google" size={20} color={theme.text} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                    <Text style={[t.bodySmall, { color: theme.text }]}>Google</Text>
                    {googleLinked ? <StatusPill tone="ok" label="Connected" /> : null}
                  </View>
                  <Text style={[t.caption, { color: theme.muted, marginTop: space(1) }]}>
                    {googleLinked
                      ? hasOtherSignIn
                        ? "Available as another sign-in method."
                        : "Your only sign-in method. Set a password before disconnecting."
                      : "Connect Google for one-tap sign in."}
                  </Text>
                </View>
                <Button
                  variant="secondary"
                  label={googleLinked ? "Disconnect" : "Connect"}
                  onPress={() => (googleLinked ? unlinkGoogle.mutate() : linkGoogle.mutate())}
                  pending={googleLinked ? unlinkGoogle.isPending : linkGoogle.isPending}
                  disabled={googleLinked && !hasOtherSignIn}
                />
              </View>
            )}
            {accountError ? (
              <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
                {accountError}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionHeader label="Active sessions" />
      <Card padded={false} style={{ paddingHorizontal: space(4) }}>
        {sessionsQuery.isPending ? (
          <View style={{ paddingVertical: space(4), gap: space(4) }}>
            {[0, 1].map((item) => (
              <View
                key={item}
                style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}
              >
                <Skeleton width={36} height={36} radius={18} />
                <View style={{ flex: 1, gap: space(2) }}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="35%" height={12} />
                </View>
              </View>
            ))}
          </View>
        ) : sessionsQuery.isError ? (
          <ErrorState
            detail={errorMessage(sessionsQuery.error, "Couldn't load active sessions.")}
            onRetry={() => void sessionsQuery.refetch()}
          />
        ) : ordered.length === 0 ? (
          <EmptyState
            icon="desktop-outline"
            title="No active sessions"
            body="Signed-in phones and browsers will appear here."
          />
        ) : (
          ordered.map((item, index) => {
            const device = describeAgent(item.userAgent);
            const isCurrent = item.token === currentToken;
            const busy = revokeOne.isPending && revokeOne.variables === item.token;
            return (
              <View
                key={item.id || item.token}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 70,
                  paddingVertical: space(3),
                  borderBottomWidth: index < ordered.length - 1 ? StyleSheet.hairlineWidth : 0,
                  borderBottomColor: theme.line,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.pill,
                    backgroundColor: theme.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: space(3),
                  }}
                >
                  <Ionicons name={device.icon} size={18} color={theme.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: space(2),
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        t.bodySmall,
                        { color: theme.text, fontFamily: "PublicSans_600SemiBold", flexShrink: 1 },
                      ]}
                    >
                      {device.label}
                    </Text>
                    {isCurrent ? <StatusPill tone="ok" label="This device" /> : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[t.caption, { color: theme.muted, marginTop: space(1) }]}
                  >
                    {item.ipAddress ? `${item.ipAddress} · ` : ""}Active{" "}
                    {formatRelativeTime(item.updatedAt)}
                  </Text>
                </View>
                {!isCurrent ? (
                  <View style={{ marginLeft: space(2) }}>
                    <Button
                      variant="secondary"
                      label="Revoke"
                      onPress={() => confirmRevoke(item)}
                      pending={busy}
                      disabled={revokeOne.isPending || revokeOthers.isPending}
                    />
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </Card>

      {revokeOne.isError ? (
        <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
          {errorMessage(revokeOne.error, "Couldn't revoke that session.")}
        </Text>
      ) : revokeOthers.isError ? (
        <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
          {errorMessage(revokeOthers.error, "Couldn't sign out other devices.")}
        </Text>
      ) : null}

      {otherSessions.length > 0 ? (
        <View style={{ marginTop: space(4) }}>
          <Button
            variant="secondary"
            full
            label="Sign out everywhere else"
            icon={<Ionicons name="log-out-outline" size={18} color={theme.text} />}
            onPress={confirmRevokeOthers}
            pending={revokeOthers.isPending}
            disabled={revokeOne.isPending}
          />
        </View>
      ) : null}

      <SectionHeader label="Danger zone" />
      <Card style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.crit }}>
        <Text style={[t.title, { color: theme.crit }]}>Delete account</Text>
        <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
          Permanently remove your GoodStrata sign-in and access to every building. Statutory
          corporation records are retained, but your identity is removed where the law allows.
        </Text>
        {!deleteOpen ? (
          <View style={{ marginTop: space(4) }}>
            <Button
              full
              variant="destructive"
              label="Delete my account"
              onPress={() => {
                setDeleteOpen(true);
                setDeleteError(null);
              }}
            />
          </View>
        ) : (
          <View style={{ gap: space(3), marginTop: space(4) }}>
            <Text style={[t.bodySmall, { color: theme.text }]}>
              Type <Text style={t.figureSmall}>{email}</Text> to confirm. This cannot be undone.
            </Text>
            <FormField
              label="Email confirmation"
              value={deleteEmail}
              onChangeText={(value) => {
                setDeleteEmail(value);
                setDeleteError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              keyboardType="email-address"
            />
            {hasPassword ? (
              <FormField
                label="Password"
                value={deletePassword}
                onChangeText={(value) => {
                  setDeletePassword(value);
                  setDeleteError(null);
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={() => deleteConfirmed && void deleteAccount()}
              />
            ) : null}
            {deleteError ? (
              <Text style={[t.bodySmall, { color: theme.crit }]}>{deleteError}</Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Button
                  full
                  variant="secondary"
                  label="Cancel"
                  disabled={deletePending}
                  onPress={() => {
                    setDeleteOpen(false);
                    setDeleteEmail("");
                    setDeletePassword("");
                    setDeleteError(null);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  full
                  variant="destructive"
                  label="Delete account"
                  disabled={!deleteConfirmed}
                  pending={deletePending}
                  onPress={() => void deleteAccount()}
                />
              </View>
            </View>
          </View>
        )}
      </Card>
    </Screen>
  );
}
