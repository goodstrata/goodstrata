import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [magicLinkClient()],
});

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  // Account settings surface (routes/settings.tsx).
  updateUser,
  changeEmail,
  changePassword,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  deleteUser,
  // Connected accounts (Settings → Security): Google link/unlink.
  listAccounts,
  linkSocial,
  unlinkAccount,
} = authClient;
