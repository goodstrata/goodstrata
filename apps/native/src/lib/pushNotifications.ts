import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { apiDelete, apiPost } from "./api";
import { authClient } from "./auth";
import { pushDataToTarget } from "./pushTarget";

/**
 * Push notifications, end to end on the device side:
 *  (a) permission + Expo push token (guarded for Expo Go / web / simulators),
 *  (b) registration with POST /profile/push-tokens once a session exists,
 *  (c) de-registration on sign-out (call `unregisterPushToken()` BEFORE
 *      `authClient.signOut()` — the DELETE needs the session cookie),
 *  (d) a foreground handler so a push still shows as a banner in-app,
 *  (e) tap → deep-link to the related entity via the shared target resolver,
 *      falling back to the notifications tab.
 *
 * Everything is best-effort: push is an accelerant, never a dependency — the
 * in-app bell row always exists regardless of what happens here.
 */

// Foreground presentation: show the banner and keep it in the shade, but stay
// quiet (no sound/badge) — the user is already in the app looking at it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Where remote push can exist at all: a real (dev/TestFlight/store) build on
 * iOS or Android. Expo Go (`appOwnership === "expo"`) lost remote-push support
 * in SDK 53, and web has no APNs/FCM. Simulators pass this check but fail the
 * token fetch — caught and swallowed in registerPushToken().
 */
function pushSupported(): boolean {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  return Constants.appOwnership !== "expo";
}

/**
 * Ask for permission (optionally) and mint this device's Expo push token.
 * Returns null wherever push can't work: unsupported runtime, permission not
 * granted, or no EAS projectId in the app config.
 */
async function fetchExpoPushToken(opts: { requestPermission: boolean }): Promise<string | null> {
  if (!pushSupported()) return null;

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && opts.requestPermission) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    // Android 13+ requires a channel to exist before a token can be minted;
    // the API sends with channelId "default" to match.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  const out = await Notifications.getExpoPushTokenAsync({ projectId });
  return out.data;
}

/** The token this app session registered — lets sign-out skip a re-fetch. */
let registeredToken: string | null = null;

/**
 * Register this device for the signed-in user. Safe to call anywhere, any
 * time: simulators (no APNs), Expo Go, web, declined permission, and offline
 * all resolve to a silent no-op — push simply stays off for this device.
 */
export async function registerPushToken(): Promise<void> {
  try {
    const token = await fetchExpoPushToken({ requestPermission: true });
    if (!token) return;
    await apiPost("/api/profile/push-tokens", {
      token,
      platform: Platform.OS as "ios" | "android",
      deviceName: Constants.deviceName ?? null,
    });
    registeredToken = token;
  } catch {
    // No push on this device for now; the server prunes dead tokens anyway.
  }
}

/**
 * Forget this device server-side. Call BEFORE authClient.signOut() — the
 * DELETE is authenticated. Never re-prompts for permission: if it was never
 * granted, no token was ever registered.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = registeredToken ?? (await fetchExpoPushToken({ requestPermission: false }));
    if (token) await apiDelete("/api/profile/push-tokens", { token });
  } catch {
    // Best effort — the server also prunes on DeviceNotRegistered.
  } finally {
    registeredToken = null;
  }
}

/**
 * The one hook the root layout mounts. Registers the device whenever a
 * session exists (sign-in and app relaunch both pass through here), and
 * routes notification taps — including the tap that cold-started the app —
 * to the related entity, falling back to the notifications tab.
 */
export function usePushNotifications(): void {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (userId) void registerPushToken();
  }, [userId]);

  // useLastNotificationResponse covers both the cold-start tap and taps while
  // running; the ref de-dupes so one response never routes twice.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponseId = useRef<string | null>(null);
  useEffect(() => {
    if (!lastResponse) return;
    const responseId = lastResponse.notification.request.identifier;
    if (handledResponseId.current === responseId) return;
    handledResponseId.current = responseId;

    const target = pushDataToTarget(lastResponse.notification.request.content.data);
    if (target) {
      router.push(target);
    } else {
      router.push("/(tabs)/notifications");
    }
  }, [lastResponse]);
}
