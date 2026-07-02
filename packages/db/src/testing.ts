import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDb, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

export interface TestDatabase {
  url: string;
  db: Database;
  cleanup(): Promise<void>;
}

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://goodstrata:goodstrata@localhost:5434/goodstrata";

/**
 * Provision an isolated, fully-migrated database for a test file.
 * Uses the dev Postgres (TEST_DATABASE_URL or the docker-compose default);
 * falls back to a throwaway testcontainer when nothing is listening (CI).
 */
export async function provisionTestDatabase(): Promise<TestDatabase> {
  const name = `gs_test_${randomBytes(6).toString("hex")}`;

  try {
    return await provisionOnServer(ADMIN_URL, name);
  } catch (err) {
    if ((err as { code?: string }).code !== "ECONNREFUSED") throw err;
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:18-alpine").start();
    const base = await provisionOnServer(container.getConnectionUri(), name);
    return {
      ...base,
      cleanup: async () => {
        await base.cleanup();
        await container.stop();
      },
    };
  }
}

async function provisionOnServer(adminUrl: string, name: string): Promise<TestDatabase> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const testUrl = url.toString();

  await runMigrations(testUrl);
  const { db, pool } = createDb(testUrl);

  return {
    url: testUrl,
    db,
    cleanup: async () => {
      await pool.end();
      const admin2 = new pg.Client({ connectionString: adminUrl });
      await admin2.connect();
      try {
        await admin2.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await admin2.end();
      }
    },
  };
}
