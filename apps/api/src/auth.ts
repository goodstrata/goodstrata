import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { accounts, type Database, sessions, users, verifications } from "@goodstrata/db";
import type { EmailProvider } from "@goodstrata/integrations";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(opts: {
  db: Database;
  secret: string;
  appUrl: string;
  email: EmailProvider;
  /**
   * Block sign-in until the address is verified. Off by default so the demo
   * (console/memory email) and local dev stay one-click; turn on in prod once
   * SES delivers real mail.
   */
  requireEmailVerification?: boolean;
  /** Rate limiting is enabled by default in production; force it on here. */
  production?: boolean;
}) {
  return betterAuth({
    secret: opts.secret,
    baseURL: `${opts.appUrl}/api/auth`,
    trustedOrigins: [opts.appUrl],
    database: drizzleAdapter(opts.db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification ?? false,
      // Not awaited — sending in-band would leak timing about whether an
      // address exists (better-auth guidance).
      sendResetPassword: async ({ user, url }) => {
        void opts.email.send({
          to: user.email,
          subject: "Reset your GoodStrata password",
          text: `Someone asked to reset the password for your GoodStrata account.\n\nReset it here: ${url}\n\nThis link expires shortly. If it wasn't you, ignore this email — your password stays the same.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        void opts.email.send({
          to: user.email,
          subject: "Confirm your email for GoodStrata",
          text: `Welcome to GoodStrata. Confirm this is your address to secure your account:\n\n${url}\n\nIf you didn't create an account, ignore this email.`,
        });
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      // Single-instance container; in-memory is correct and zero-setup. Move
      // to "database"/"secondary-storage" if the app is ever scaled out.
      storage: "memory",
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/sign-in/magic-link": { window: 60, max: 5 },
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          void opts.email.send({
            to: email,
            subject: "Sign in to GoodStrata",
            text: `Click to sign in: ${url}\n\nThis link expires shortly. If you didn't request it, ignore this email.`,
          });
        },
      }),
    ],
  });
}
