/**
 * Matrix e2e: walks every (curve, signatureAlgorithm, hash) combo
 * the platform claims to support and verifies the full onboard +
 * sign path on testnet.
 *
 * Combos covered (one dwallet per curve, multiple sign tests where
 * the same curve supports several sigAlgo/hash pairs):
 *
 *   SECP256K1 + ECDSASecp256k1 + KECCAK256       (Ethereum)
 *   SECP256K1 + ECDSASecp256k1 + SHA256
 *   SECP256K1 + ECDSASecp256k1 + DoubleSHA256    (Bitcoin legacy)
 *   SECP256K1 + Taproot         + SHA256         (Bitcoin Taproot)
 *   SECP256R1 + ECDSASecp256r1  + SHA256         (P-256 / WebAuthn)
 *   ED25519   + EdDSA           + SHA512         (Solana)
 *   RISTRETTO + SchnorrkelSubstrate + Merlin     (Substrate)
 *
 * Required env (same as `e2e-sdk.ts`):
 *   BACKEND_URL                 default http://localhost:3000
 *   ADMIN_API_KEY               required if creating a fresh user
 *   MPCKIT_API_KEY                 reuse an existing user (preferred —
 *                                avoids re-funding a deposit address)
 *   IKA_NETWORK                 testnet | mainnet (default testnet)
 *   E2E_USER_SEED_HEX           32 bytes hex; deterministic seed
 *
 * Usage:
 *   bun run scripts/e2e-sdk-matrix.ts
 */
import { createHash } from "node:crypto";
import {
  Curve,
  Hash,
  MPCKit,
  MPCKitError,
  SignatureAlgorithm,
} from "@mpckit/sdk";

/**
 * Derive a per-curve seed by hashing `(seed || curve_name)` so each
 * curve's encryption-key address is independent. Without this, a
 * default seed like `0x42*32` can collide with on-chain artifacts
 * registered by other teams using the same well-known dummy seed
 * (we hit this on testnet ED25519: a prior session had already
 * registered an EncryptionKey at that exact address).
 */
function curveSeed(seed: Uint8Array, curve: Curve): Uint8Array {
  const h = createHash("sha256");
  h.update(seed);
  h.update(curve);
  return Uint8Array.from(h.digest());
}

interface Combo {
  name: string;
  curve: Curve;
  sigAlgo: SignatureAlgorithm;
  hash: Hash;
  expectedSigBytes: number[];
}

// Grouped by curve so we can share one dwallet across compatible
// sigAlgo/hash combos. Each combo gets its own log row.
const MATRIX: Record<Curve, Combo[]> = {
  [Curve.SECP256K1]: [
    {
      name: "Ethereum (SECP256K1+ECDSA+KECCAK256)",
      curve: Curve.SECP256K1,
      sigAlgo: SignatureAlgorithm.ECDSASecp256k1,
      hash: Hash.KECCAK256,
      expectedSigBytes: [64, 65],
    },
    {
      name: "SECP256K1+ECDSA+SHA256",
      curve: Curve.SECP256K1,
      sigAlgo: SignatureAlgorithm.ECDSASecp256k1,
      hash: Hash.SHA256,
      expectedSigBytes: [64, 65],
    },
    {
      name: "Bitcoin legacy (SECP256K1+ECDSA+DoubleSHA256)",
      curve: Curve.SECP256K1,
      sigAlgo: SignatureAlgorithm.ECDSASecp256k1,
      hash: Hash.DoubleSHA256,
      expectedSigBytes: [64, 65],
    },
    {
      name: "Bitcoin Taproot (SECP256K1+Taproot+SHA256)",
      curve: Curve.SECP256K1,
      sigAlgo: SignatureAlgorithm.Taproot,
      hash: Hash.SHA256,
      expectedSigBytes: [64],
    },
  ],
  [Curve.SECP256R1]: [
    {
      name: "P-256/WebAuthn (SECP256R1+ECDSA+SHA256)",
      curve: Curve.SECP256R1,
      sigAlgo: SignatureAlgorithm.ECDSASecp256r1,
      hash: Hash.SHA256,
      expectedSigBytes: [64, 65],
    },
  ],
  [Curve.ED25519]: [
    {
      name: "Solana (ED25519+EdDSA+SHA512)",
      curve: Curve.ED25519,
      sigAlgo: SignatureAlgorithm.EdDSA,
      hash: Hash.SHA512,
      expectedSigBytes: [64],
    },
  ],
  [Curve.RISTRETTO]: [
    {
      name: "Substrate (RISTRETTO+Schnorrkel+Merlin)",
      curve: Curve.RISTRETTO,
      sigAlgo: SignatureAlgorithm.SchnorrkelSubstrate,
      hash: Hash.Merlin,
      expectedSigBytes: [64],
    },
  ],
};

interface EnvShape {
  backendUrl: string;
  adminApiKey: string | undefined;
  apiKey: string | undefined;
  network: "testnet" | "mainnet";
  seed: Uint8Array;
}

function loadEnv(): EnvShape {
  const backendUrl = (
    process.env.BACKEND_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const adminApiKey = process.env.ADMIN_API_KEY;
  const apiKey = process.env.MPCKIT_API_KEY;
  if (!adminApiKey && !apiKey) {
    throw new Error("set ADMIN_API_KEY (to create a user) or MPCKIT_API_KEY");
  }
  const network = (process.env.IKA_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";
  const seedHex = process.env.E2E_USER_SEED_HEX ?? "42".repeat(32);
  const stripped = seedHex.startsWith("0x") ? seedHex.slice(2) : seedHex;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]+$/.test(stripped)) {
    throw new Error("E2E_USER_SEED_HEX must be 32 bytes hex");
  }
  return {
    backendUrl,
    adminApiKey,
    apiKey,
    network,
    seed: Uint8Array.from(Buffer.from(stripped, "hex")),
  };
}

async function createUser(
  backendUrl: string,
  adminApiKey: string,
): Promise<{ userId: string; apiKey: string }> {
  const email = `e2e-matrix-${Date.now()}@mpckit.test`;
  const res = await fetch(`${backendUrl}/v1/admin/users`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, keyName: "e2e-matrix" }),
  });
  if (!res.ok) {
    throw new Error(
      `admin create user failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    user: { id: string };
    key: { plaintext: string };
  };
  return { userId: body.user.id, apiKey: body.key.plaintext };
}

interface SignAttempt {
  combo: Combo;
  ok: boolean;
  bytes?: number;
  signRequestId?: string;
  txDigest?: string | null;
  errorCode?: string;
  errorMessage?: string;
  attempts: number;
}

// Sweep cron promotes pending → ready every minute. 90s × 5 covers
// up to 2 sweep cycles + 30s of mint slack, well past the ~3s mint +
// 60s worst-case wait on a fresh bucket.
const PRESIGN_RETRY_DELAY_MS = 90_000;
const PRESIGN_MAX_RETRIES = 5;
// Curve names in this set are skipped at onboard. Useful for known
// broken combos.
const SKIP_CURVES = new Set<string>(
  (process.env.E2E_SKIP_CURVES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

async function signWithRetry(
  api: MPCKit,
  args: {
    seed: Uint8Array;
    dwalletId: string;
    curve: Curve;
    signatureAlgorithm: SignatureAlgorithm;
    hashScheme: Hash;
    message: Uint8Array;
    userSecretKeyShareHex: string;
  },
): Promise<{
  result: Awaited<ReturnType<typeof api.sign>>;
  attempts: number;
}> {
  for (let attempt = 1; attempt <= PRESIGN_MAX_RETRIES; attempt++) {
    try {
      const result = await api.sign({ ...args, timeoutMs: 240_000 });
      return { result, attempts: attempt };
    } catch (err) {
      if (
        err instanceof MPCKitError &&
        err.code === "PRESIGN_POOL_EMPTY" &&
        attempt < PRESIGN_MAX_RETRIES
      ) {
        console.error(
          `    presign pool empty, retrying in ${PRESIGN_RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${PRESIGN_MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, PRESIGN_RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const env = loadEnv();
  console.error(`[matrix] backend=${env.backendUrl} network=${env.network}`);

  let userId: string;
  let apiKey: string;
  if (env.apiKey) {
    apiKey = env.apiKey;
    userId = "(reused)";
    console.error("[matrix] reusing existing api key from MPCKIT_API_KEY env");
  } else {
    if (!env.adminApiKey)
      throw new Error("ADMIN_API_KEY required to create user");
    ({ userId, apiKey } = await createUser(env.backendUrl, env.adminApiKey));
    console.error(`[matrix] created user ${userId}`);
  }

  const api = new MPCKit({
    baseUrl: env.backendUrl,
    apiKey,
    network: env.network,
  });

  const balance = await api.balance();
  console.error(`[matrix] starting balance: $${balance.creditsUsd}`);

  const results: SignAttempt[] = [];
  const onboardErrors: { curve: Curve; error: string }[] = [];

  for (const [curveStr, combos] of Object.entries(MATRIX) as [
    Curve,
    Combo[],
  ][]) {
    console.error(`\n[matrix] === ${curveStr} ===`);
    if (SKIP_CURVES.has(curveStr)) {
      console.error(`[matrix] SKIP ${curveStr} (E2E_SKIP_CURVES)`);
      for (const combo of combos) {
        results.push({
          combo,
          ok: false,
          attempts: 0,
          errorCode: "SKIPPED",
          errorMessage: "in E2E_SKIP_CURVES",
        });
      }
      continue;
    }
    let dwalletId: string | undefined;
    let userSecretKeyShareHex: string | undefined;
    const perCurveSeed = curveSeed(env.seed, curveStr);

    try {
      console.error(`[matrix] onboarding ${curveStr}…`);
      const onboarded = await api.onboard({
        seed: perCurveSeed,
        curve: curveStr,
        timeoutMs: 600_000,
      });
      dwalletId = onboarded.dwallet.id;
      userSecretKeyShareHex = onboarded.userSecretKeyShareHex;
      console.error(
        `[matrix] onboarded ${curveStr}: dwallet=${onboarded.dwallet.id} sui=${onboarded.dwallet.suiDwalletId}`,
      );
    } catch (err) {
      const msg =
        err instanceof MPCKitError
          ? `${err.code}: ${err.message}`
          : String(err);
      console.error(`[matrix] onboard ${curveStr} FAILED: ${msg}`);
      onboardErrors.push({ curve: curveStr, error: msg });
      // Still record skipped attempts for reporting completeness.
      for (const combo of combos) {
        results.push({
          combo,
          ok: false,
          attempts: 0,
          errorCode: "ONBOARD_FAILED",
          errorMessage: msg,
        });
      }
      continue;
    }

    if (!dwalletId || !userSecretKeyShareHex) continue;

    for (const combo of combos) {
      const message = new Uint8Array(32);
      const tag = `e2e-${combo.name}`.slice(0, 32);
      message.set(new TextEncoder().encode(tag));
      try {
        console.error(`[matrix] signing ${combo.name}…`);
        const { result, attempts } = await signWithRetry(api, {
          seed: perCurveSeed,
          dwalletId,
          curve: combo.curve,
          signatureAlgorithm: combo.sigAlgo,
          hashScheme: combo.hash,
          message,
          userSecretKeyShareHex,
        });
        const sizeOk = combo.expectedSigBytes.includes(result.signature.length);
        console.error(
          `[matrix]  ${sizeOk ? "OK" : "BAD"} ${combo.name}: ${result.signature.length} bytes (attempts=${attempts})`,
        );
        results.push({
          combo,
          ok: sizeOk,
          bytes: result.signature.length,
          signRequestId: result.signRequestId,
          txDigest: result.txDigest,
          attempts,
          errorCode: sizeOk ? undefined : "BAD_SIG_LENGTH",
          errorMessage: sizeOk
            ? undefined
            : `got ${result.signature.length}, expected one of ${combo.expectedSigBytes.join(",")}`,
        });
      } catch (err) {
        const code = err instanceof MPCKitError ? err.code : "UNKNOWN";
        const message = err instanceof MPCKitError ? err.message : String(err);
        console.error(`[matrix] FAILED ${combo.name}: ${code}: ${message}`);
        results.push({
          combo,
          ok: false,
          attempts: 0,
          errorCode: code,
          errorMessage: message,
        });
      }
    }
  }

  const finalBalance = await api.balance();
  const okCount = results.filter((r) => r.ok).length;
  const skipCount = results.filter((r) => r.errorCode === "SKIPPED").length;
  const total = results.length;
  const failCount = total - okCount - skipCount;

  console.error("\n[matrix] === summary ===");
  for (const r of results) {
    const tag = r.ok ? "OK " : "FAIL";
    const detail = r.ok
      ? `${r.bytes}B sig, ${r.attempts} attempt(s), tx=${r.txDigest ?? "-"}`
      : `${r.errorCode ?? "?"}: ${(r.errorMessage ?? "").slice(0, 120)}`;
    console.error(`  [${tag}] ${r.combo.name} -- ${detail}`);
  }
  console.error(
    `\n[matrix] ${okCount}/${total} combos passed (${skipCount} skipped, ${failCount} failed); balance: $${balance.creditsUsd} -> $${finalBalance.creditsUsd}`,
  );
  if (onboardErrors.length > 0) {
    console.error(
      `[matrix] ${onboardErrors.length} curves failed at onboard:`,
      onboardErrors,
    );
  }

  console.log(
    JSON.stringify(
      {
        userId,
        apiKey,
        startingBalanceUsd: balance.creditsUsd,
        endingBalanceUsd: finalBalance.creditsUsd,
        startingBalanceMicro: balance.creditsMicro,
        endingBalanceMicro: finalBalance.creditsMicro,
        results: results.map((r) => ({
          name: r.combo.name,
          curve: r.combo.curve,
          sigAlgo: r.combo.sigAlgo,
          hash: r.combo.hash,
          ok: r.ok,
          bytes: r.bytes ?? null,
          signRequestId: r.signRequestId ?? null,
          txDigest: r.txDigest ?? null,
          attempts: r.attempts,
          errorCode: r.errorCode ?? null,
          errorMessage: r.errorMessage ?? null,
        })),
      },
      null,
      2,
    ),
  );

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[matrix] fatal:", err);
  process.exit(1);
});
