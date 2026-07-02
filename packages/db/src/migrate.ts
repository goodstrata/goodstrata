import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

export async function runMigrations(connectionString: string, migrationsFolder?: string) {
  const { db, pool } = createDb(connectionString);
  try {
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
