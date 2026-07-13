import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";
import { provisionTestDatabase, type TestDatabase } from "../src/testing.js";

const migrationsRoot = fileURLToPath(new URL("../migrations", import.meta.url));

let tdb: TestDatabase;
let partialMigrations: string;

beforeAll(async () => {
  partialMigrations = await mkdtemp(join(tmpdir(), "goodstrata-migrations-0016-"));
  await mkdir(join(partialMigrations, "meta"), { recursive: true });

  const files = await readdir(migrationsRoot);
  for (const file of files) {
    const match = /^(\d{4})_.+\.sql$/.exec(file);
    if (match && Number(match[1]) <= 16) {
      await copyFile(join(migrationsRoot, file), join(partialMigrations, file));
    }
  }

  const journalPath = join(migrationsRoot, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    dialect: string;
    version: string;
    entries: { idx: number }[];
  };
  await writeFile(
    join(partialMigrations, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 16) }),
  );

  tdb = await provisionTestDatabase(partialMigrations);
});

afterAll(async () => {
  await tdb?.cleanup();
  if (partialMigrations) await rm(partialMigrations, { recursive: true, force: true });
});

describe("migration 0017 statutory retention backfill", () => {
  it("classifies existing documents and dates existing ballots and proxies", async () => {
    const client = new pg.Client({ connectionString: tdb.url });
    await client.connect();

    const schemeId = randomUUID();
    const lotId = randomUUID();
    const grantorId = randomUUID();
    const proxyPersonId = randomUUID();
    const motionId = randomUUID();
    const financialId = randomUUID();
    const certificateId = randomUUID();
    const planId = randomUUID();
    const otherId = randomUUID();

    try {
      await client.query(
        `INSERT INTO schemes
          (id, name, plan_of_subdivision, address_line1, suburb, postcode, tier)
         VALUES ($1, 'Migration Test OC', 'PS0017T', '1 Test Street', 'Melbourne', '3000', 3)`,
        [schemeId],
      );
      await client.query(
        `INSERT INTO lots (id, scheme_id, lot_number, lot_type, entitlement, liability)
         VALUES ($1, $2, '1', 'residential', 10, 10)`,
        [lotId, schemeId],
      );
      await client.query(
        `INSERT INTO people (id, scheme_id, given_name, family_name)
         VALUES ($1, $3, 'Grantor', 'Owner'), ($2, $3, 'Proxy', 'Holder')`,
        [grantorId, proxyPersonId, schemeId],
      );
      await client.query(
        `INSERT INTO motions (id, scheme_id, title, text, resolution_type, status)
         VALUES ($1, $2, 'Migration ballot', 'Test the retained ballot', 'ordinary', 'open')`,
        [motionId, schemeId],
      );
      await client.query(
        `INSERT INTO votes
          (id, motion_id, lot_id, cast_by_person_id, choice, entitlement_weight, cast_at)
         VALUES ($1, $2, $3, $4, 'for', 10, '2024-04-05T10:00:00Z')`,
        [randomUUID(), motionId, lotId, grantorId],
      );
      await client.query(
        `INSERT INTO proxies
          (id, scheme_id, grantor_person_id, lot_id, proxy_person_id, scope, expires_on, created_at)
         VALUES
          ($1, $3, $4, $5, $6, 'standing', '2025-06-15', '2024-06-15T10:00:00Z'),
          ($2, $3, $4, $5, $6, 'standing', NULL, '2024-08-20T10:00:00Z')`,
        [randomUUID(), randomUUID(), schemeId, grantorId, lotId, proxyPersonId],
      );

      const uploadedBy = JSON.stringify({ type: "system", id: "migration-test" });
      await client.query(
        `INSERT INTO documents
          (id, scheme_id, category, title, storage_key, mime, size_bytes, retention_until,
           uploaded_by, created_at)
         VALUES
          ($1, $5, 'financial', 'Existing ledger', 'legacy/ledger.pdf', 'application/pdf', 1,
           '2030-01-10', $6::jsonb, '2020-01-10T10:00:00Z'),
          ($2, $5, 'certificate', 'Existing certificate', 'legacy/certificate.pdf',
           'application/pdf', 1, NULL, $6::jsonb, '2021-02-03T10:00:00Z'),
          ($3, $5, 'plan_of_subdivision', 'Existing plan', 'legacy/plan.pdf',
           'application/pdf', 1, '2025-01-01', $6::jsonb, '2019-03-04T10:00:00Z'),
          ($4, $5, 'other', 'Operational note', 'legacy/note.txt', 'text/plain', 1,
           NULL, $6::jsonb, '2018-04-05T10:00:00Z')`,
        [financialId, certificateId, planId, otherId, schemeId, uploadedBy],
      );
    } finally {
      await client.end();
    }

    await runMigrations(tdb.url);

    const verify = new pg.Client({ connectionString: tdb.url });
    await verify.connect();
    try {
      const documents = await verify.query<{
        id: string;
        retention_class: string;
        retention_basis: string | null;
        retention_until: string | null;
      }>(
        `SELECT id, retention_class, retention_basis, retention_until::text
         FROM documents
         WHERE id = ANY($1::uuid[])
         ORDER BY id`,
        [[financialId, certificateId, planId, otherId]],
      );
      const byId = new Map(documents.rows.map((row) => [row.id, row]));

      expect(byId.get(financialId)).toMatchObject({
        retention_class: "statutory_7_years",
        retention_basis: "OC Act financial record — minimum seven years",
        retention_until: "2030-01-10",
      });
      expect(byId.get(certificateId)).toMatchObject({
        retention_class: "statutory_7_years",
        retention_basis: "OC Act owners corporation record — minimum seven years",
        retention_until: "2028-02-03",
      });
      expect(byId.get(planId)).toMatchObject({
        retention_class: "permanent",
        retention_basis: "Building-life record",
        retention_until: null,
      });
      expect(byId.get(otherId)).toMatchObject({
        retention_class: "operational",
        retention_basis: null,
        retention_until: null,
      });

      const votes = await verify.query<{ retention_until: string }>(
        "SELECT retention_until::text FROM votes",
      );
      expect(votes.rows).toEqual([{ retention_until: "2025-04-05" }]);

      const proxies = await verify.query<{ retention_until: string }>(
        "SELECT retention_until::text FROM proxies ORDER BY created_at",
      );
      expect(proxies.rows).toEqual([
        { retention_until: "2026-06-15" },
        { retention_until: "2026-08-20" },
      ]);
    } finally {
      await verify.end();
    }
  });
});
