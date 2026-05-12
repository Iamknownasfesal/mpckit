/**
 * End-to-end smoke for the onboarding path:
 *
 *   POST /v1/admin/users           bootstrap a user + api key
 *   POST /v1/encryption-keys       register the user's class-groups key
 *   POST /v1/dwallets              zero-trust DKG (single-PTB onboard)
 *   poll coordinator               wait for AwaitingKeyHolderSignature
 *   POST /v1/dwallets/:id/accept   finalise to Active
 *
 * Required env:
 *   BACKEND_URL                 default http://localhost:3000
 *   ADMIN_API_KEY               the bootstrap admin key (env or DB-issued)
 *   IKA_NETWORK                 testnet | mainnet (default testnet)
 *   E2E_USER_SEED_HEX           32 bytes hex; deterministic share key seed
 *                               so re-runs reuse the same encryption-key
 *                               address on chain
 *
 * The seed pins the on-chain encryption-key address. First run registers
 * it; subsequent runs hit the idempotent `(userId, curve)` path.
 *
 * Usage (with backend running locally):
 *   bun run scripts/e2e-onboard.ts
 */
import {
  Curve,
  createRandomSessionIdentifier,
  getNetworkConfig,
  IkaClient,
  prepareDKGAsync,
  UserShareEncryptionKeys,
} from "@ika.xyz/sdk";
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

interface Env {
  backendUrl: string;
  adminApiKey: string;
  network: "testnet" | "mainnet";
  seed: Uint8Array;
}

function loadEnv(): Env {
  const backendUrl = (
    process.env.BACKEND_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) throw new Error("missing ADMIN_API_KEY");
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
    network,
    seed: Uint8Array.from(Buffer.from(stripped, "hex")),
  };
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

async function postJson<T>(
  url: string,
  bearer: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${url} -> ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function main() {
  const env = loadEnv();
  console.error(`[e2e] backend=${env.backendUrl} network=${env.network}`);

  // 1. Bootstrap a one-shot user. Email is randomised to avoid uniqueness
  //    conflicts on re-runs; idempotency for the share-encryption key
  //    is keyed on `(userId, curve)`, so the user must be fresh too.
  const email = `e2e-${Date.now()}@mpckit.test`;
  console.error(`[e2e] creating user ${email} …`);
  const created = await postJson<{
    user: { id: string };
    key: { plaintext: string };
  }>(`${env.backendUrl}/v1/admin/users`, env.adminApiKey, {
    email,
    keyName: "e2e-onboard",
  });
  const userKey = created.key.plaintext;
  console.error(`[e2e]   user ${created.user.id} (key issued)`);

  // 2. Spin up an IkaClient against the same network the backend uses.
  const url = process.env.SUI_GRPC_URL ?? getJsonRpcFullnodeUrl(env.network);
  const suiClient = new SuiJsonRpcClient({ url, network: env.network });
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig(env.network),
    cache: true,
  });
  await ikaClient.initialize();

  // 3. User-share encryption identity. Deterministic from the seed so
  //    re-runs hit the same encryption-key address on chain.
  const keys = await UserShareEncryptionKeys.fromRootSeedKey(
    env.seed,
    Curve.SECP256K1,
  );
  const signerAddress = keys.getSuiAddress();
  console.error(`[e2e] user share signer address: ${signerAddress}`);

  // 4. Register the encryption key through the API.
  const encryptionKeySignature = await keys.getEncryptionKeySignature();
  console.error("[e2e] POST /v1/encryption-keys");
  const ek = await postJson<{
    id: string;
    suiObjectId: string;
    suiAddress: string;
  }>(`${env.backendUrl}/v1/encryption-keys`, userKey, {
    curve: 0,
    encryptionKeyHex: toHex(keys.encryptionKey),
    encryptionKeySignatureHex: toHex(encryptionKeySignature),
    signerPublicKeyHex: toHex(keys.getSigningPublicKeyBytes()),
  });
  console.error(`[e2e]   encryption key id ${ek.id} sui ${ek.suiObjectId}`);

  // 5. Run DKG client-side. The session id binds the centralized
  //    party's broadcast to this DKG run.
  const sessionIdBytes = createRandomSessionIdentifier();
  const networkKey = await ikaClient.getLatestNetworkEncryptionKey();
  const dkg = await prepareDKGAsync(
    ikaClient,
    Curve.SECP256K1,
    keys,
    sessionIdBytes,
    signerAddress,
  );
  console.error("[e2e] DKG prep done");

  // 6. Submit the onboarding PTB through the API.
  console.error("[e2e] POST /v1/dwallets");
  const onboard = await postJson<{
    account: { id: string; suiObjectId: string };
    dwallet: { id: string; suiDwalletId: string; status: string };
    txDigest: string;
    encryptedUserSecretKeyShareId: string;
  }>(`${env.backendUrl}/v1/dwallets`, userKey, {
    encryptionKeyId: ek.id,
    dwalletNetworkEncryptionKeyId: networkKey.id,
    centralizedPublicKeyShareAndProofHex: toHex(dkg.userDKGMessage),
    encryptedCentralizedSecretShareAndProofHex: toHex(
      dkg.encryptedUserShareAndProof,
    ),
    userPublicOutputHex: toHex(dkg.userPublicOutput),
    signerPublicKeyHex: toHex(keys.getSigningPublicKeyBytes()),
    sessionIdentifierHex: toHex(sessionIdBytes),
  });
  console.error(`[e2e]   account ${onboard.account.suiObjectId}`);
  console.error(`[e2e]   dwallet ${onboard.dwallet.suiDwalletId}`);
  console.error(`[e2e]   digest  ${onboard.txDigest}`);

  // 7. Wait for the coordinator to drive the dWallet to
  //    `AwaitingKeyHolderSignature` so the public output is finalised.
  //    Backend already extracted the encrypted-user-share id from DKG
  //    events, so we read it from the onboard response.
  console.error("[e2e] waiting for AwaitingKeyHolderSignature …");
  const awaitingDw = await ikaClient.getDWalletInParticularState(
    onboard.dwallet.suiDwalletId,
    "AwaitingKeyHolderSignature",
    { timeout: 600_000, interval: 2_000 },
  );
  const encryptedShareId = onboard.encryptedUserSecretKeyShareId;
  console.error(`[e2e]   encrypted share id ${encryptedShareId}`);

  // 8. Sign the dwallet's public output locally; this is the user's
  //    attestation that they accept the encrypted share.
  const userOutputSignature = await keys.getUserOutputSignature(
    awaitingDw,
    new Uint8Array(dkg.userPublicOutput),
  );

  // 9. Finalise via the accept endpoint.
  console.error(`[e2e] POST /v1/dwallets/${onboard.dwallet.id}/accept`);
  const accepted = await postJson<{
    dwallet: { id: string; status: string };
  }>(`${env.backendUrl}/v1/dwallets/${onboard.dwallet.id}/accept`, userKey, {
    encryptedUserSecretKeyShareId: encryptedShareId,
    userOutputSignatureHex: toHex(userOutputSignature),
  });
  console.error(`[e2e]   dwallet status: ${accepted.dwallet.status}`);

  console.log(
    JSON.stringify(
      {
        userId: created.user.id,
        apiKey: userKey,
        encryptionKey: ek,
        account: onboard.account,
        dwallet: { ...onboard.dwallet, status: accepted.dwallet.status },
        digests: {
          onboard: onboard.txDigest,
        },
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
