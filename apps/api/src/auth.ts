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
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await opts.email.send({
            to: email,
            subject: "Sign in to GoodStrata",
            text: `Click to sign in: ${url}\n\nThis link expires shortly. If you didn't request it, ignore this email.`,
          });
        },
      }),
    ],
  });
}
