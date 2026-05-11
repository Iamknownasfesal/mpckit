/**
 * End-to-end smoke using `@mpckit/sdk` against a locally running
 * backend. Drives the full happy path:
 *
 *   1. admin creates a user + issues an api key
 *   2. SDK reads `/v1/billing/pricing` and `/v1/billing/address`
 *   3. fund that address with >= minimum SUI (manual digest, or
 *      auto-broadcast from `E2E_FUNDER_KEYPAIR_BECH32`)
 *   4. SDK declares the deposit txDigest, balance increases
 *   5. SDK runs `onboard` (encryption key + DKG + accept)
 *   6. SDK runs `sign` (prepare → centralized sig → submit → poll)
 *
 * Required env:
 *   BACKEND_URL                  default http://localhost:3000
 *   ADMIN_API_KEY                bootstrap admin key
 *   IKA_NETWORK                  testnet | mainnet (default testnet)
 *   E2E_USER_SEED_HEX            32 bytes hex; deterministic share key seed
 *   E2E_DEPOSIT_TX_DIGEST        a Sui tx digest funding the user's
 *                                deposit address. Use this when funding
 *                                out-of-band; mutually exclusive with
 *                                the autonomous funder below.
 *   E2E_FUNDER_KEYPAIR_BECH32    bech32 (`suiprivkey…`); when set the
 *                                script signs + broadcasts a SUI
 *                                transfer to the deposit address and
 *                                uses the resulting digest. Pick this
 *                                for CI.
 *   E2E_FUND_AMOUNT_MIST         optional, defaults to
 *                                BILLING_MIN_DEPOSIT_MICRO+epsilon
 *                                (2_000_000_000 mist = 2 SUI)
 *
 * Usage:
 *   bun run scripts/e2e-sdk.ts
 */
import { Curve, Hash, MpcKit, SignatureAlgorithm } from "@mpckit/sdk";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

interface EnvShape {
  backendUrl: string;
  adminApiKey: string;
  network: "testnet" | "mainnet";
  seed: Uint8Array;
  depositTxDigest: string | undefined;
  funderKeypair: Ed25519Keypair | undefined;
  fundAmountMist: bigint;
  rpcUrl: string;
}

function loadEnv(): EnvShape {
  const backendUrl = (
    process.env.BACKEND_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) throw new Error("missing ADMIN_API_KEY");
  const network = (process.env.IKA_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";
  // Each run wants a fresh seed unless explicitly overridden — the
  // encryption-key Sui address is deterministic from the seed, and
  // chain state outlives the backend DB, so reused seeds across
  // different backend users collide in the coordinator's per-address
  // storage on DKG.
  const seedHex =
    process.env.E2E_USER_SEED_HEX ??
    Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
  const stripped = seedHex.startsWith("0x") ? seedHex.slice(2) : seedHex;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]+$/.test(stripped)) {
    throw new Error("E2E_USER_SEED_HEX must be 32 bytes hex");
  }

  let funderKeypair: Ed25519Keypair | undefined;
  if (process.env.E2E_FUNDER_KEYPAIR_BECH32) {
    const decoded = decodeSuiPrivateKey(process.env.E2E_FUNDER_KEYPAIR_BECH32);
    if (decoded.scheme !== "ED25519") {
      throw new Error(
        `E2E_FUNDER_KEYPAIR_BECH32 must be ED25519, got ${decoded.scheme}`,
      );
    }
    funderKeypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
  }

  if (process.env.E2E_DEPOSIT_TX_DIGEST && funderKeypair) {
    throw new Error(
      "E2E_DEPOSIT_TX_DIGEST and E2E_FUNDER_KEYPAIR_BECH32 are mutually exclusive",
    );
  }

  const fundAmountMist = process.env.E2E_FUND_AMOUNT_MIST
    ? BigInt(process.env.E2E_FUND_AMOUNT_MIST)
    : 2_000_000_000n;

  return {
    backendUrl,
    adminApiKey,
    network,
    seed: Uint8Array.from(Buffer.from(stripped, "hex")),
    depositTxDigest: process.env.E2E_DEPOSIT_TX_DIGEST,
    funderKeypair,
    fundAmountMist,
    rpcUrl: process.env.SUI_GRPC_URL ?? getJsonRpcFullnodeUrl(network),
  };
}

async function fundDepositAddress(
  rpcUrl: string,
  network: "testnet" | "mainnet",
  funder: Ed25519Keypair,
  recipient: string,
  amountMist: bigint,
): Promise<string> {
  const client = new SuiJsonRpcClient({ url: rpcUrl, network });
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [amountMist]);
  tx.transferObjects([coin], recipient);
  tx.setSender(funder.toSuiAddress());
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: funder,
    include: { effects: true },
  });
  // signAndExecuteTransaction can return before local execution finishes,
  // in which case $kind is neither Transaction nor FailedTransaction.
  // The digest is always present though; the fullnode will catch up by
  // the time the next API call lands.
  const digest =
    result.$kind === "Transaction"
      ? result.Transaction.digest
      : result.$kind === "FailedTransaction"
        ? (() => {
            throw new Error(
              `funder tx failed: ${JSON.stringify(result.FailedTransaction.status)}`,
            );
          })()
        : (result as { digest?: string }).digest;
  if (!digest) {
    throw new Error(
      `funder tx: unexpected response shape: ${JSON.stringify(result).slice(0, 300)}`,
    );
  }
  return digest;
}

async function createUser(
  backendUrl: string,
  adminApiKey: string,
): Promise<{ userId: string; apiKey: string }> {
  const email = `e2e-${Date.now()}@mpckit.test`;
  const res = await fetch(`${backendUrl}/v1/admin/users`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, keyName: "e2e-sdk" }),
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

async function main() {
  const env = loadEnv();
  console.error(`[e2e] backend=${env.backendUrl} network=${env.network}`);

  let userId: string;
  let apiKey: string;
  if (process.env.MPCKIT_API_KEY) {
    apiKey = process.env.MPCKIT_API_KEY;
    userId = "(reused)";
    console.error("[e2e] reusing existing api key from MPCKIT_API_KEY env");
  } else {
    ({ userId, apiKey } = await createUser(env.backendUrl, env.adminApiKey));
    console.error(`[e2e] created user ${userId}`);
  }

  const api = new MpcKit({
    baseUrl: env.backendUrl,
    apiKey,
    network: env.network,
  });

  // 1. Pricing snapshot.
  const pricing = await api.billingPricing();
  console.error("[e2e] pricing:", JSON.stringify(pricing));

  // 2. Deposit address.
  const { address } = await api.depositAddress();
  console.error(`[e2e] user deposit address: ${address}`);

  // 3. Get a deposit digest one of three ways: prepaid (caller passed
  //    MPCKIT_API_KEY for a user that already has credits), out-of-band
  //    (caller supplied E2E_DEPOSIT_TX_DIGEST), or autonomous (caller
  //    supplied E2E_FUNDER_KEYPAIR_BECH32). Then declare it.
  let depositDigest = env.depositTxDigest;
  if (!depositDigest && env.funderKeypair) {
    console.error(
      `[e2e] funding deposit address from ${env.funderKeypair.toSuiAddress()} (${env.fundAmountMist} mist)…`,
    );
    depositDigest = await fundDepositAddress(
      env.rpcUrl,
      env.network,
      env.funderKeypair,
      address,
      env.fundAmountMist,
    );
    console.error(`[e2e] funded with tx ${depositDigest}`);
  }

  if (depositDigest) {
    const declared = await api.declareDeposit(depositDigest);
    console.error(
      `[e2e] declared deposit (duplicate=${declared.duplicate}); balance=$${declared.creditsUsd}`,
    );
  } else {
    console.error(
      "[e2e] no deposit digest and no funder; assuming user already has credits",
    );
  }

  // 4. Onboard a zero-trust SECP256K1 dwallet.
  console.error("[e2e] onboard …");
  const onboard = await api.onboard({
    seed: env.seed,
    curve: Curve.SECP256K1,
    timeoutMs: 600_000,
  });
  console.error(
    `[e2e] onboard ok: dwallet=${onboard.dwallet.id} sui=${onboard.dwallet.suiDwalletId}`,
  );

  // 5. Sign a 32-byte test message (Taproot/SHA256).
  const message = new Uint8Array(32);
  message.set(new TextEncoder().encode("mpckit e2e sign smoke"));
  console.error("[e2e] sign …");
  const result = await api.sign({
    seed: env.seed,
    dwalletId: onboard.dwallet.id,
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.Taproot,
    hashScheme: Hash.SHA256,
    message,
    userSecretKeyShareHex: onboard.userSecretKeyShareHex,
  });
  console.error(
    `[e2e] sign ok: ${result.signature.length} bytes (sui digest ${result.txDigest})`,
  );

  console.log(
    JSON.stringify(
      {
        userId,
        apiKey,
        depositAddress: address,
        balance: await api.balance(),
        dwallet: onboard.dwallet,
        encryptionKey: onboard.encryptionKey,
        signRequestId: result.signRequestId,
        signatureHex: Buffer.from(result.signature).toString("hex"),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
