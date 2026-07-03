import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either a live transaction or the root db — services accept both. */
export type DbHandle = Database | Transaction;

/**
 * Normalise a Postgres URL into node-postgres connection config with TLS
 * handled consistently across every consumer (pool, pg-boss, the LISTEN
 * client). Managed Postgres (Supabase, RDS, …) requires TLS, but node-postgres
 * ≥ 8.22 verifies the chain when `sslmode` is in the URL and rejects Supabase's
 * pooler cert (SELF_SIGNED_CERT_IN_CHAIN). So we strip `sslmode` and drive TLS
 * ourselves — encrypt without chain verification. Local/dev URLs carry no
 * sslmode and keep connecting in the clear.
 * TODO(hardening): pin the provider CA and flip to rejectUnauthorized: true.
 */
export function pgConfig(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: false };
} {
  const wantsTls = /[?&]sslmode=(require|prefer|verify-ca|verify-full|no-verify)\b/i.test(
    connectionString,
  );
  const cleaned = connectionString
    .replace(/([?&])sslmode=[^&]*/i, "$1")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
  return wantsTls
    ? { connectionString: cleaned, ssl: { rejectUnauthorized: false } }
    : { connectionString: cleaned };
}

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ ...pgConfig(connectionString), max: 10 });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

export { schema };
