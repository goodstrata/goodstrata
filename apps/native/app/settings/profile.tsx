import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Text, View } from "react-native";
import {
  Button,
  Card,
  FormField,
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
import { API_ORIGIN } from "../../src/lib/config";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface ProfileUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  phone?: string | null;
}

interface AuthResponse {
  error?: { message?: string | null } | null;
}

type UpdateProfile = (input: { name?: string; phone?: string | null }) => Promise<AuthResponse>;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function normaliseAuPhone(raw: string): string {
  const compact = raw.replace(/[\s().-]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("0")) return `+61${compact.slice(1)}`;
  if (compact.startsWith("61")) return `+${compact}`;
  return compact;
}

function cookieHeaders(): Record<string, string> {
  try {
    const cookie = authClient.getCookie();
    return cookie ? { Cookie: cookie } : {};
  } catch {
    return {};
  }
}

async function avatarRequest(method: "POST" | "DELETE", body?: FormData): Promise<void> {
  const response = await fetch(`${API_ORIGIN}/api/profile/avatar`, {
    method,
    headers: { ...cookieHeaders(), Accept: "application/json" },
    body,
  });
  if (response.ok) return;

  let detail = method === "POST" ? "Couldn't upload that photo." : "Couldn't remove that photo.";
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) detail = payload.error.message;
  } catch {
    // The status-specific fallback above is clearer than an empty/non-JSON body.
  }
  throw new Error(detail);
}

function avatarSource(image: string | null | undefined) {
  if (!image) return undefined;
  if (/^(file|content|data):/.test(image)) return { uri: image };
  if (/^https?:\/\//.test(image)) {
    return image.startsWith(API_ORIGIN) ? { uri: image, headers: cookieHeaders() } : { uri: image };
  }
  return { uri: `${API_ORIGIN}${image}`, headers: cookieHeaders() };
}

export default function ProfileSettings() {
  const theme = useTheme();
  const session = authClient.useSession();
  const user = session.data?.user as ProfileUser | undefined;
  const userId = user?.id;
  const userName = user?.name;
  const userPhone = user?.phone;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [detailsPending, setDetailsPending] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [email, setEmail] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarOperation, setAvatarOperation] = useState<"upload" | "remove" | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setName(userName ?? "");
    setPhone(userPhone ?? "");
  }, [userId, userName, userPhone]);

  const shownAvatar = useMemo(
    () => avatarSource(avatarPreview ?? user?.image),
    [avatarPreview, user?.image],
  );

  const saveDetails = async () => {
    if (!user) return;
    const nextName = name.trim();
    const nextPhone = normaliseAuPhone(phone);
    if (!nextName) {
      setDetailsError("Enter a display name.");
      return;
    }
    if (nextName.length > 80) {
      setDetailsError("Keep your display name under 80 characters.");
      return;
    }
    if (nextPhone && !E164.test(nextPhone)) {
      setDetailsError("Enter a valid mobile number, for example 0412 345 678.");
      return;
    }

    setDetailsPending(true);
    setDetailsError(null);
    setDetailsSaved(false);
    try {
      // The server declares phone as a Better Auth additional user field. The
      // generic native client cannot infer server-only fields, so narrow the
      // method at this call boundary while keeping the runtime auth path.
      const result = await (authClient.updateUser as unknown as UpdateProfile)({
        name: nextName,
        phone: nextPhone || null,
      });
      if (result.error) throw new Error(result.error.message ?? "Couldn't save your profile.");
      setName(nextName);
      setPhone(nextPhone);
      setDetailsSaved(true);
      await session.refetch();
    } catch (error) {
      setDetailsError(message(error, "Couldn't save your profile."));
    } finally {
      setDetailsPending(false);
    }
  };

  const chooseAvatar = async () => {
    setAvatarError(null);
    let permission: ImagePicker.MediaLibraryPermissionResponse;
    try {
      permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    } catch (error) {
      setAvatarError(message(error, "Couldn't open your photo library."));
      return;
    }
    if (!permission.granted) {
      Alert.alert(
        "Photo access is off",
        permission.canAskAgain
          ? "Allow photo access to choose a profile picture."
          : "Turn on photo access for GoodStrata in Settings, then try again.",
        permission.canAskAgain
          ? [{ text: "OK" }]
          : [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => void Linking.openSettings() },
            ],
      );
      return;
    }

    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
    } catch (error) {
      setAvatarError(message(error, "Couldn't open your photo library."));
      return;
    }
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      setAvatarError("Keep images under 5 MB.");
      return;
    }

    const mime = asset.mimeType?.toLowerCase() ?? "image/jpeg";
    if (!AVATAR_MIME.has(mime)) {
      setAvatarError("Use a PNG, JPEG, WebP or GIF image.");
      return;
    }
    const extension =
      mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : mime === "image/gif"
            ? "gif"
            : "jpg";
    const form = new FormData();
    form.append("file", {
      uri: asset.uri,
      name: asset.fileName ?? `avatar.${extension}`,
      type: mime,
    } as unknown as Blob);

    setAvatarPreview(asset.uri);
    setAvatarOperation("upload");
    try {
      await avatarRequest("POST", form);
      await session.refetch();
      setAvatarPreview(null);
    } catch (error) {
      setAvatarPreview(null);
      setAvatarError(message(error, "Couldn't upload that photo."));
    } finally {
      setAvatarOperation(null);
    }
  };

  const removeAvatar = () => {
    Alert.alert("Remove profile photo?", "Your initials will be shown instead.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setAvatarOperation("remove");
          setAvatarError(null);
          void avatarRequest("DELETE")
            .then(() => session.refetch())
            .catch((error) => setAvatarError(message(error, "Couldn't remove that photo.")))
            .finally(() => setAvatarOperation(null));
        },
      },
    ]);
  };

  const startEmailChange = async () => {
    if (!user) return;
    const next = email.trim().toLowerCase();
    if (!EMAIL.test(next)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (next === user.email.toLowerCase()) {
      setEmailError("That's already your email address.");
      return;
    }

    setEmailPending(true);
    setEmailError(null);
    try {
      const result = await authClient.changeEmail({
        newEmail: next,
        callbackURL: Linking.createURL("/settings/profile"),
      });
      if (result.error) throw new Error(result.error.message ?? "Couldn't start the change.");
      setPendingEmail(next);
      setEmail("");
    } catch (error) {
      setEmailError(message(error, "Couldn't start the change."));
    } finally {
      setEmailPending(false);
    }
  };

  const resendVerification = async () => {
    if (!user) return;
    setVerificationPending(true);
    setEmailError(null);
    try {
      const result = await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL: Linking.createURL("/settings/profile"),
      });
      if (result.error) throw new Error(result.error.message ?? "Couldn't send the email.");
      Alert.alert("Verification sent", `Check ${user.email} for a fresh link.`);
    } catch (error) {
      setEmailError(message(error, "Couldn't send the email."));
    } finally {
      setVerificationPending(false);
    }
  };

  return (
    <Screen title="Profile" topInset={false}>
      {session.isPending ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(4) }}>
            <Skeleton width={80} height={80} radius={40} />
            <View style={{ flex: 1, gap: space(2) }}>
              <Skeleton width="55%" height={16} />
              <Skeleton width="80%" height={13} />
            </View>
          </View>
        </Card>
      ) : !user ? (
        <Card>
          <Text style={[t.body, { color: theme.muted }]}>Sign in again to edit your profile.</Text>
        </Card>
      ) : (
        <>
          <Text style={[t.bodySmall, { color: theme.muted, marginBottom: space(2) }]}>
            Keep the identity and contact details shown across The Registry up to date.
          </Text>

          <SectionHeader label="Profile photo" />
          <Card>
            <View style={{ alignItems: "center" }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: theme.line,
                  backgroundColor: theme.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {shownAvatar ? (
                  <Image
                    source={shownAvatar}
                    style={{ width: 80, height: 80 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={[t.title, { color: theme.accent }]}>
                    {initials(user.name, user.email)}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  t.bodySmall,
                  { color: theme.muted, textAlign: "center", marginTop: space(3) },
                ]}
              >
                Shown beside your name across the register. PNG, JPEG, WebP or GIF, up to 5 MB.
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: space(2),
                  marginTop: space(4),
                }}
              >
                <Button
                  variant="secondary"
                  label={user.image ? "Replace photo" : "Choose photo"}
                  icon={<Ionicons name="image-outline" size={18} color={theme.text} />}
                  onPress={() => void chooseAvatar()}
                  pending={avatarOperation === "upload"}
                  disabled={avatarOperation !== null}
                />
                {user.image ? (
                  <Button
                    variant="secondary"
                    label="Remove"
                    icon={<Ionicons name="trash-outline" size={18} color={theme.text} />}
                    onPress={removeAvatar}
                    pending={avatarOperation === "remove"}
                    disabled={avatarOperation !== null}
                  />
                ) : null}
              </View>
              {avatarError ? (
                <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
                  {avatarError}
                </Text>
              ) : null}
            </View>
          </Card>

          <SectionHeader label="Your details" />
          <Card>
            <View style={{ gap: space(3) }}>
              <FormField
                label="Display name"
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setDetailsError(null);
                  setDetailsSaved(false);
                }}
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
              />
              <FormField
                label="Mobile number"
                value={phone}
                onChangeText={(value) => {
                  setPhone(value);
                  setDetailsError(null);
                  setDetailsSaved(false);
                }}
                placeholder="0412 345 678"
                autoComplete="tel"
                textContentType="telephoneNumber"
                keyboardType="phone-pad"
                returnKeyType="done"
                onSubmitEditing={() => void saveDetails()}
              />
              <Text style={[t.caption, { color: theme.muted, marginTop: -space(1) }]}>
                Your mobile number enables SMS notification preferences.
              </Text>
              {detailsError ? (
                <Text style={[t.bodySmall, { color: theme.crit }]}>{detailsError}</Text>
              ) : detailsSaved ? (
                <Text style={[t.bodySmall, { color: theme.ok }]}>Profile saved.</Text>
              ) : null}
              <Button
                full
                label="Save details"
                onPress={() => void saveDetails()}
                pending={detailsPending}
                disabled={
                  !name.trim() ||
                  (name.trim() === user.name.trim() &&
                    normaliseAuPhone(phone) === (user.phone ?? ""))
                }
              />
            </View>
          </Card>

          <SectionHeader label="Email address" />
          <Card>
            <View style={{ gap: space(3) }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: space(2),
                  padding: space(3),
                  borderRadius: radius.control,
                  backgroundColor: theme.accentSoft,
                }}
              >
                <Ionicons name="mail-outline" size={18} color={theme.muted} />
                <Text style={[t.bodySmall, { color: theme.text, flexShrink: 1 }]}>
                  {user.email}
                </Text>
                <StatusPill
                  tone={user.emailVerified ? "ok" : "warn"}
                  label={user.emailVerified ? "Verified" : "Unverified"}
                />
              </View>
              {!user.emailVerified ? (
                <Button
                  variant="secondary"
                  label="Resend verification"
                  onPress={() => void resendVerification()}
                  pending={verificationPending}
                  disabled={emailPending}
                />
              ) : null}
              {pendingEmail ? (
                <View
                  style={{
                    padding: space(3),
                    borderRadius: radius.control,
                    backgroundColor: theme.infoSoft,
                  }}
                >
                  <Text style={[t.label, { color: theme.info }]}>Confirm your new address</Text>
                  <Text style={[t.bodySmall, { color: theme.text, marginTop: space(1) }]}>
                    Follow the emailed confirmation link for {pendingEmail}. Keep signing in with{" "}
                    {user.email} until the change completes.
                  </Text>
                </View>
              ) : null}
              <Text style={[t.bodySmall, { color: theme.muted }]}>
                Changes need confirmation from an emailed link before your sign-in address moves.
              </Text>
              <FormField
                label="New email"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setEmailError(null);
                }}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="send"
                onSubmitEditing={() => void startEmailChange()}
              />
              {emailError ? (
                <Text style={[t.bodySmall, { color: theme.crit }]}>{emailError}</Text>
              ) : null}
              <Button
                full
                label="Send confirmation"
                onPress={() => void startEmailChange()}
                pending={emailPending}
                disabled={!email.trim() || verificationPending}
              />
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}
