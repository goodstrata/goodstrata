import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  accounts,
  type Database,
  jwks,
  oauthAccessTokens,
  oauthApplications,
  oauthConsents,
  sessions,
  users,
  verifications,
} from "@goodstrata/db";
import type { EmailProvider } from "@goodstrata/integrations";
import { betterAuth } from "better-auth";
import { jwt, magicLink, mcp } from "better-auth/plugins";

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(opts: {
  db: Database;
  secret: string;
  appUrl: string;
  email: EmailProvider;
  /**
   * Public origin serving the MCP endpoint + protected-resource metadata.
   * Defaults to appUrl (same-origin local dev). In prod: mcp.goodstrata.com.au.
   */
  mcpUrl?: string;
  /**
   * Block sign-in until the address is verified. Off by default so the demo
   * (console/memory email) and local dev stay one-click; turn on in prod once
   * SES delivers real mail.
   */
  requireEmailVerification?: boolean;
  /** Rate limiting is enabled by default in production; force it on here. */
  production?: boolean;
}) {
  const mcpResource = `${(opts.mcpUrl ?? opts.appUrl).replace(/\/$/, "")}/mcp`;
  const loginPage = `${opts.appUrl.replace(/\/$/, "")}/login`;
  return betterAuth({
    secret: opts.secret,
    baseURL: `${opts.appUrl}/api/auth`,
    // claude.ai is the MCP client; loopback covers local MCP inspectors and
    // native clients doing the loopback OAuth redirect.
    trustedOrigins: [opts.appUrl, "https://claude.ai", "http://localhost", "http://127.0.0.1"],
    database: drizzleAdapter(opts.db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        // better-auth mcp/oidc-provider + jwt plugin tables (see schema/mcp.ts).
        oauthApplication: oauthApplications,
        oauthAccessToken: oauthAccessTokens,
        oauthConsent: oauthConsents,
        jwks,
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
        // OAuth 2.1 / MCP authorization-server endpoints. Dynamic client
        // registration is the cheapest to abuse, so it gets the tightest cap.
        "/mcp/register": { window: 60, max: 5 },
        "/mcp/authorize": { window: 60, max: 20 },
        "/mcp/token": { window: 60, max: 30 },
        "/oauth2/register": { window: 60, max: 5 },
        "/oauth2/authorize": { window: 60, max: 20 },
        "/oauth2/token": { window: 60, max: 30 },
        "/oauth2/consent": { window: 60, max: 20 },
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
      // Signs OIDC id_tokens and exposes /api/auth/jwks (referenced by the
      // OAuth discovery metadata). Must precede mcp() which sets useJWTPlugin.
      jwt(),
      // OAuth 2.1 Authorization Server for MCP. The mcp plugin internally
      // instantiates oidc-provider, so it is NOT added separately. DCR + PKCE
      // (OAuth 2.1) are enabled; scopes are the GoodStrata MCP tiers plus the
      // OIDC defaults (openid/profile/email/offline_access) that the plugin
      // always merges in.
      mcp({
        loginPage,
        resource: mcpResource,
        oidcConfig: {
          loginPage,
          allowDynamicClientRegistration: true,
          requirePKCE: true,
          useJWTPlugin: true,
          scopes: ["mcp:read", "mcp:write", "mcp:govern"],
        },
      }),
    ],
  });
}
