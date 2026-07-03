import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { createDb } from "./client.js";

/**
 * Postgres 18 ships a built-in `uuidv7()`; the schema uses it as a column
 * default. On older servers (e.g. Supabase, currently PG17) it doesn't exist,
 * so install a correct pure-SQL equivalent before migrating. No-op where the
 * builtin is present (the demo's PG18 image), so both targets migrate cleanly.
 */
async function ensureUuidv7(pool: Pool) {
  const { rows } = await pool.query<{ exists: boolean }>(
    "select exists(select 1 from pg_proc where proname = 'uuidv7') as exists",
  );
  if (rows[0]?.exists) return;
  await pool.query(`
    create or replace function public.uuidv7() returns uuid
    language plpgsql volatile as $$
    declare
      ts_ms bytea := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
      v bytea := uuid_send(gen_random_uuid());
    begin
      v := overlay(v placing ts_ms from 1 for 6);        -- 48-bit unix-ms prefix
      v := set_byte(v, 6, (get_byte(v, 6) & 15) | 112);  -- version nibble = 7
      return encode(v, 'hex')::uuid;                     -- variant bits kept from v4
    end $$;
  `);
}

export async function runMigrations(connectionString: string, migrationsFolder?: string) {
  const { db, pool } = createDb(connectionString);
  try {
    await ensureUuidv7(pool);
    await migrate(db, {
      migrationsFolder: migrationsFolder ?? new URL("../migrations", import.meta.url).pathname,
    });
  } finally {
    await pool.end();
  }
}

// CLI entrypoint: pnpm db:migrate
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
