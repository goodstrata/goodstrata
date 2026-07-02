import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDb>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either a live transaction or the root db — services accept both. */
export type DbHandle = Database | Transaction;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

export { schema };
