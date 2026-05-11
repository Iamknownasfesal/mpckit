import { createHash } from "node:crypto";
/**
 * Try ED25519 onboard with multiple distinct seeds. Used to localise
 * the `dynamic_field::add` abort: if it fails for every seed, the bug
 * is curve-specific (likely SDK or coordinator). If it fails only for
 * the matrix's "42…" seed, the bug is on-chain residue from a prior
 * abandoned attempt with that exact encryption_key_address.
 */
import { Curve, MpcKit, MpcKitError } from "@mpckit/sdk";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_API_KEY) throw new Error("ADMIN_API_KEY required");
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

async function createUser(): Promise<{ userId: string; apiKey: string }> {
  const email = `e2e-ed-${Date.now()}@mpckit.test`;
  const res = await fetch(`${BACKEND_URL}/v1/admin/users`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, keyName: "e2e-ed" }),
  });
  if (!res.ok) throw new Error(await res.text());
  const j = (await res.json()) as {
    user: { id: string };
    key: { plaintext: string };
  };
  return { userId: j.user.id, apiKey: j.key.plaintext };
}

async function fundUser(api: MpcKit): Promise<void> {
  const { address } = await api.depositAddress();
  console.error(`[repro] deposit address: ${address}`);
  // Caller responsible for funding via sui CLI; we just await balance.
  // For this script we assume a pre-funded admin op (see fund-and-declare.sh).
  const balance = await api.balance();
  console.error(`[repro] balance: $${balance.creditsUsd}`);
  if (BigInt(balance.creditsMicro) < 51_000n) {
    throw new Error(
      `need >=$0.051 (DKG + buffer) to onboard; have $${balance.creditsUsd}`,
    );
  }
}

function seed(label: string): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(label).digest());
}

async function tryOnboard(
  api: MpcKit,
  label: string,
  s: Uint8Array,
): Promise<void> {
  console.error(`[repro] onboard ED25519 with seed=${label}…`);
  try {
    const r = await api.onboard({
      seed: s,
      curve: Curve.ED25519,
      timeoutMs: 600_000,
    });
    console.error(
      `[repro] OK ${label}: dwallet=${r.dwallet.id} sui=${r.dwallet.suiDwalletId}`,
    );
  } catch (err) {
    if (err instanceof MpcKitError) {
      console.error(`[repro] FAIL ${label}: ${err.code}: ${err.message}`);
    } else {
      console.error(`[repro] FAIL ${label}:`, err);
    }
  }
}

async function main() {
  const env = process.env.MPCKIT_API_KEY
    ? { apiKey: process.env.MPCKIT_API_KEY, userId: "(reused)" }
    : await createUser();
  console.error(`[repro] user=${env.userId}`);
  const api = new MpcKit({
    baseUrl: BACKEND_URL,
    apiKey: env.apiKey,
    network: "testnet",
  });
  await fundUser(api);

  // Seed A: matrix script's seed (0x42 * 32). Known to fail in matrix runs.
  await tryOnboard(api, "A=0x42*32", new Uint8Array(32).fill(0x42));
  // Seed B: a different deterministic seed. Should isolate seed-specific
  // residue from genuine curve-specific bugs.
  await tryOnboard(api, "B=sha256('repro-ed-B')", seed("repro-ed-B"));
  // Seed C: yet another. Three points fan out the diagnosis.
  await tryOnboard(api, "C=sha256('repro-ed-C')", seed("repro-ed-C"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
