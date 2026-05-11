import { env } from "@/config/env";
import { log } from "@/config/log";
import { audit } from "@/shared/audit";
import { getDb } from "@/shared/db/client";
import { apiKeys, users } from "@/shared/db/schema";
/**
 * Admin bootstrap.
 *
 * Operators set `ADMIN_API_KEY` in env on first deploy. On boot, if a
 * key is configured AND no row in `api_keys` matches its hash, we
 * create an admin user and insert this key. Idempotent: running the
 * boot multiple times never duplicates.
 *
 * The admin user's email defaults to `admin@<host>`; operators can
 * change it later via the API.
 */
import { eq } from "drizzle-orm";
import { hashKey, networkFromPlaintext } from "./keys";

const ADMIN_EMAIL = "admin@mpckit.local";
const KEY_NAME = "bootstrap-admin";

export async function bootstrapAdmin(): Promise<void> {
  if (!env.ADMIN_API_KEY) {
    log.info("ADMIN_API_KEY not set, skipping admin bootstrap");
    return;
  }
  const hash = hashKey(env.ADMIN_API_KEY);
  const db = getDb();

  const existing = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);
  if (existing.length > 0) {
    log.info(
      { keyId: existing[0]?.id },
      "admin bootstrap: key already provisioned",
    );
    return;
  }

  log.info("admin bootstrap: provisioning admin user + key");

  // Create or reuse the admin user. We key on email so re-rotating
  // ADMIN_API_KEY against the same install just adds a new key row.
  let adminId: string;
  const existingUser = await db
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);
  if (existingUser.length > 0) {
    adminId = existingUser[0]!.id;
    if (!existingUser[0]!.isAdmin) {
      await db
        .update(users)
        .set({ isAdmin: true })
        .where(eq(users.id, adminId));
    }
  } else {
    const inserted = await db
      .insert(users)
      .values({
        email: ADMIN_EMAIL,
        name: "bootstrap-admin",
        isAdmin: true,
      })
      .returning({ id: users.id });
    adminId = inserted[0]!.id;
  }

  const prefix = env.ADMIN_API_KEY.slice(0, 16);
  // The plaintext prefix tells us which network the operator minted
  // this key for. Unknown prefix (legacy key without env tag) defaults
  // to testnet so the bootstrap is never silently mainnet.
  const network = networkFromPlaintext(env.ADMIN_API_KEY) ?? "testnet";
  const inserted = await db
    .insert(apiKeys)
    .values({
      userId: adminId,
      network,
      keyHash: hash,
      keyPrefix: prefix,
      name: KEY_NAME,
      scopes: ["admin:*"],
    })
    .returning({ id: apiKeys.id });

  await audit({
    event: "key.bootstrap",
    userId: adminId,
    apiKeyId: inserted[0]?.id ?? null,
    metadata: { source: "ADMIN_API_KEY env" },
  });

  log.warn(
    { adminId, keyPrefix: prefix },
    "admin bootstrap complete: rotate ADMIN_API_KEY out of env once a UI key is issued",
  );
}
