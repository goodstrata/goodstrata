import * as SecureStore from "expo-secure-store";
import { ApiError, apiPost } from "./api";

const PENDING_INVITE_KEY = "goodstrata_pending_invite";

export function rememberPendingInvite(token: string): Promise<void> {
  return SecureStore.setItemAsync(PENDING_INVITE_KEY, token);
}

export function pendingInvite(): Promise<string | null> {
  return SecureStore.getItemAsync(PENDING_INVITE_KEY);
}

export async function consumePendingInvite(
  explicitToken?: string | null,
): Promise<{ schemeId: string } | null> {
  const token = explicitToken || (await pendingInvite());
  if (!token) return null;
  try {
    const result = await apiPost<{ schemeId: string }>("/api/invites/accept", { token });
    await SecureStore.deleteItemAsync(PENDING_INVITE_KEY);
    return result;
  } catch (error) {
    // Expired/used tokens should not trap every future sign-in in a retry loop.
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
      await SecureStore.deleteItemAsync(PENDING_INVITE_KEY);
    }
    throw error;
  }
}
