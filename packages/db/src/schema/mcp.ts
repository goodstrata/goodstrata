/**
 * better-auth plugin-managed tables for the OAuth 2.1 / MCP authorization
 * server (plugins: `mcp` — which wraps `oidc-provider` — plus `jwt`).
 *
 * Field/property names are camelCase to match the better-auth model field
 * names its Drizzle adapter looks up (`schema[model][field]`); the runtime
 * `casing: "snake_case"` maps them to snake_case columns, mirroring the
 * identity tables in ./auth.ts. These are mapped onto better-auth model names
 * in apps/api/src/auth.ts (`oauthApplication`, `oauthAccessToken`,
 * `oauthConsent`, `jwks`).
 *
 * Purely additive — no existing table is touched.
 */
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

/** Registered OAuth clients (incl. dynamically registered MCP clients). */
export const oauthApplications = pgTable("oauth_applications", {
  id: text().primaryKey(),
  name: text().notNull(),
  icon: text(),
  metadata: text(),
  clientId: text().notNull().unique(),
  clientSecret: text(),
  redirectUrls: text().notNull(),
  type: text().notNull(),
  disabled: boolean().default(false),
  userId: text().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Issued access/refresh tokens with their granted scopes. */
export const oauthAccessTokens = pgTable("oauth_access_tokens", {
  id: text().primaryKey(),
  accessToken: text().unique(),
  refreshToken: text().unique(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  clientId: text(),
  userId: text().references(() => users.id, { onDelete: "cascade" }),
  scopes: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Per-user consent records for a client's requested scopes. */
export const oauthConsents = pgTable("oauth_consents", {
  id: text().primaryKey(),
  clientId: text(),
  userId: text().references(() => users.id, { onDelete: "cascade" }),
  scopes: text(),
  consentGiven: boolean(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** JWKS keypairs used by the jwt plugin to sign ID tokens / expose /jwks. */
export const jwks = pgTable("jwks", {
  id: text().primaryKey(),
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }),
});
