import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { renderEmail } from "@goodstrata/core";
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
  /**
   * "Sign in with Google" (OAuth). Optional — when absent the provider isn't
   * registered, the web app hides the button (via /api/demo-info's
   * socialProviders), and nothing else changes, so self-hosters without
   * Google credentials stay clean. Register
   * `<APP_URL>/api/auth/callback/google` as the redirect URI in Google Cloud
   * Console (better-auth's default callback path under our baseURL).
   */
  google?: { clientId: string; clientSecret: string };
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
    // Only registered when credentials are supplied — better-auth 404s
    // /sign-in/social for unknown providers, and the web app hides the button.
    socialProviders: opts.google
      ? {
          google: {
            clientId: opts.google.clientId,
            clientSecret: opts.google.clientSecret,
          },
        }
      : undefined,
    account: {
      accountLinking: {
        enabled: true,
        // Google verifies email ownership, so a Google sign-in whose address
        // matches an existing email/password user links to that account
        // instead of erroring with account_not_linked (better-auth's
        // recommended trustedProviders config).
        trustedProviders: ["google"],
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification ?? false,
      // Not awaited — sending in-band would leak timing about whether an
      // address exists (better-auth guidance).
      sendResetPassword: async ({ user, url }) => {
        const { html, text } = renderEmail({
          preheader: "Reset the password for your GoodStrata account.",
          heading: "Reset your password",
          intro:
            "Someone asked to reset the password for your GoodStrata account. Choose a new one using the button below.",
          cta: { label: "Reset password", url },
          footerNote:
            "This link expires shortly. If it wasn't you, ignore this email — your password stays the same.",
        });
        void opts.email.send({
          to: user.email,
          subject: "Reset your GoodStrata password",
          text,
          html,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const { html, text } = renderEmail({
          preheader: "Confirm your email address to secure your GoodStrata account.",
          heading: "Confirm your email",
          intro:
            "Welcome to GoodStrata. Confirm this is your address to secure your account and start using The Registry.",
          cta: { label: "Confirm your email", url },
          footerNote:
            "This link expires shortly. If you didn't create a GoodStrata account, ignore this email.",
        });
        void opts.email.send({
          to: user.email,
          subject: "Confirm your email for GoodStrata",
          text,
          html,
        });
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        // better-auth 1.6.23 names this callback sendChangeEmailConfirmation
        // (the "sendChangeEmailVerification" of older docs). It fires when the
        // current address is verified — the confirmation link goes to the OLD
        // address so a hijacked session can't silently move the account. For an
        // unverified address better-auth falls through to sendVerificationEmail
        // (above), mailing the NEW address. Either way the change only lands
        // once a link is clicked, which the UI surfaces as a pending state.
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          const { html, text } = renderEmail({
            preheader: `Confirm the change of your GoodStrata email to ${newEmail}.`,
            heading: "Confirm your email change",
            intro:
              "We received a request to change the email address on your GoodStrata account. Confirm it below to complete the change.",
            blocks: [
              {
                kind: "keyValueTable",
                caption: "Email change",
                rows: [
                  { label: "Current address", value: user.email },
                  { label: "New address", value: newEmail },
                ],
              },
            ],
            cta: { label: "Confirm email change", url },
            footerNote: `This link expires shortly. If you didn't ask for this, ignore this email — your address stays ${user.email}.`,
          });
          void opts.email.send({
            to: user.email,
            subject: "Confirm your GoodStrata email change",
            text,
            html,
          });
        },
      },
      // Deletion is immediate: no sendDeleteAccountVerification callback, so the
      // /delete-user endpoint removes the account in-band. The web flow gates it
      // behind a typed confirmation plus the current password (which also
      // satisfies better-auth's fresh-session requirement for a stale cookie).
      deleteUser: {
        enabled: true,
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
        "/sign-in/social": { window: 60, max: 10 },
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
          const { html, text } = renderEmail({
            preheader: "Your secure sign-in link for GoodStrata.",
            heading: "Sign in to GoodStrata",
            intro:
              "Use the button below to sign in to your GoodStrata account. No password needed.",
            cta: { label: "Sign in", url },
            footerNote:
              "This link expires shortly and can only be used once. If you didn't request it, ignore this email.",
          });
          void opts.email.send({
            to: email,
            subject: "Sign in to GoodStrata",
            text,
            html,
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
