import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either a live transaction or the root db — services accept both. */
export type DbHandle = Database | Transaction;

/**
 * TLS chain-verification policy, env-driven:
 *
 *  - DB_SSL_REJECT_UNAUTHORIZED=true|false wins when set.
 *  - Otherwise: verify in production, permissive elsewhere. The asymmetry is
 *    deliberate — dev/CI talk to docker/testcontainer Postgres or a Supabase
 *    pooler whose cert chain is self-signed (SELF_SIGNED_CERT_IN_CHAIN), so
 *    verification there only breaks the loop, and dev traffic carries no
 *    member data. Production fails closed unless explicitly opted out.
 *  - DB_SSL_CA pins the provider CA (inline PEM, or a path to a PEM file) —
 *    required for verification to pass against Supabase's self-signed chain.
 */
function sslOptions(): { rejectUnauthorized: boolean; ca?: string } {
  const flag = process.env.DB_SSL_REJECT_UNAUTHORIZED;
  const rejectUnauthorized =
    flag !== undefined ? flag !== "false" : process.env.NODE_ENV === "production";
  const rawCa = process.env.DB_SSL_CA;
  const ca = rawCa
    ? rawCa.includes("-----BEGIN")
      ? rawCa
      : readFileSync(rawCa, "utf8")
    : undefined;
  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}

/**
 * Normalise a Postgres URL into node-postgres connection config with TLS
 * handled consistently across every consumer (pool, pg-boss, the LISTEN
 * client). Managed Postgres (Supabase, RDS, …) requires TLS, but node-postgres
 * ≥ 8.22 applies its own semantics when `sslmode` is in the URL, so we strip
 * `sslmode` and drive TLS ourselves: always encrypt, with chain verification
 * per `sslOptions()` (env-driven; see above). Local/dev URLs carry no sslmode
 * and keep connecting in the clear.
 */
export function pgConfig(connectionString: string): {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean; ca?: string };
} {
  const wantsTls = /[?&]sslmode=(require|prefer|verify-ca|verify-full|no-verify)\b/i.test(
    connectionString,
  );
  const cleaned = connectionString
    .replace(/([?&])sslmode=[^&]*/i, "$1")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
  return wantsTls
    ? { connectionString: cleaned, ssl: sslOptions() }
    : { connectionString: cleaned };
}

/**
 * Supabase exposes a session pooler on :5432 (one Postgres connection held per
 * client, no multiplexing) and a transaction pooler on :6543 that multiplexes
 * many clients over a small Postgres pool — the right choice for the bursty
 * request path, which otherwise exhausts the session pooler under concurrent
 * page fan-out. Only Supabase pooler URLs are rewritten; direct/self-host URLs
 * (and LISTEN/pg-boss connections that need session mode) are left untouched.
 */
export function toTransactionPooler(connectionString: string): string {
  return connectionString.replace(/(pooler\.supabase\.com):5432\b/i, "$1:6543");
}

export function createDb(
  connectionString: string,
  opts?: { max?: number; transactionPool?: boolean },
) {
  const url = opts?.transactionPool ? toTransactionPooler(connectionString) : connectionString;
  const pool = new pg.Pool({
    ...pgConfig(url),
    max: opts?.max ?? 10,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

export { schema };
