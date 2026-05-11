import { log } from "@/config/log";
/**
 * Run drizzle migrations from the compiled SQL in
 * `src/shared/db/migrations`.
 *
 * Used both at boot (`runMigrations()` in api.ts/worker.ts when
 * DATABASE_URL is set) and from CLI (`bun run db:migrate`).
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./client";

export async function runMigrations(): Promise<void> {
  const db = getDb();
  log.info("running database migrations");
  await migrate(db, { migrationsFolder: "src/shared/db/migrations" });
  log.info("database migrations applied");
}

if (import.meta.main) {
  await runMigrations();
  await closeDb();
  process.exit(0);
}
