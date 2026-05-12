/**
 * Postgres connection + drizzle binding.
 *
 * Lazy: building the connection pool is deferred to first use so a
 * deployment without DATABASE_URL still boots (e.g. for rendering
 * /v1/health, /metrics, public read endpoints) and only fails when
 * something actually tries to read or write.
 *
 * Self-host: point DATABASE_URL at any Postgres ≥ 14. We rely on the
 * `pgcrypto` extension's `gen_random_uuid()` for primary keys, which is
 * built into PG 13+. The first migration enables it.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import { log } from "@/config/log";
import * as schema from "./schema";

let _client: postgres.Sql | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function buildPool(url: string): postgres.Sql {
  return postgres(url, {
    // Reasonable defaults for an HTTP-front service: small pool,
    // lifecycle bounded so we don't sit on idle connections forever.
    max: 10,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    onnotice: () => {
      // Suppress pg notices (e.g. "extension already exists" on
      // re-run migrations); errors still log normally.
    },
  });
}

export function getDb() {
  if (_db) return _db;
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  _client = buildPool(env.DATABASE_URL);
  _db = drizzle(_client, { schema });
  log.info({ dbConfigured: true }, "postgres pool ready");
  return _db;
}

/** True when the env has a database url (i.e. auth/persistence is on). */
export function isDbConfigured(): boolean {
  return Boolean(env.DATABASE_URL);
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = undefined;
    _db = undefined;
  }
}

export { schema };
