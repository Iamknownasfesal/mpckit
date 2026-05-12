/**
 * Per-step latency breakdown for onboard + sign. Replicates exactly
 * what `MpcKit.onboard()` and `MpcKit.sign()` do, but with
 * `performance.now()` boundaries between every primitive so we can
 * see where the wall-clock latency is actually spent.
 *
 * Categories per step (so the totals are easy to read):
 *
 *   crypto    local WASM work (no network)
 *   http-api  call to MpcKit backend
 *   ika-rpc   call to upstream Sui gRPC (via @ika.xyz/sdk's IkaClient)
 *   mpc-wait  polling the coordinator until the network MPC settles
 *
 * The mpc-wait steps are the dominant cost; this bench makes that
 * legible to the eye instead of a single black-box "onboard 38s".
 *
 * Required env (reuse a funded user from the matrix bench):
 *   MPCKIT_API_KEY, IKA_NETWORK, BACKEND_URL, E2E_USER_SEED_HEX,
 *   BENCH_CURVE (default SECP256K1), BENCH_SIGN_ITERS (default 5).
 */
import { createHash, randomBytes } from "node:crypto";
import { getNetworkConfig, IkaClient } from "@ika.xyz/sdk";
import {
  Curve,
  Hash,
  inlineCryptoEngine,
  MpcKit,
  MpcKitError,
  SignatureAlgorithm,
} from "@mpckit/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";

type Category = "crypto" | "http-api" | "ika-rpc" | "mpc-wait";
type Step = { name: string; ms: number; cat: Category };

const CURVE_NUMBER: Record<Curve, number> = {
  [Curve.SECP256K1]: 0,
  [Curve.SECP256R1]: 1,
  [Curve.ED25519]: 2,
  [Curve.RISTRETTO]: 3,
};
const SIGN_NUM: Record<Curve, Record<SignatureAlgorithm, number>> = {
  [Curve.SECP256K1]: {
    [SignatureAlgorithm.ECDSASecp256k1]: 0,
    [SignatureAlgorithm.Taproot]: 1,
    [SignatureAlgorithm.ECDSASecp256r1]: -1,
    [SignatureAlgorithm.EdDSA]: -1,
    [SignatureAlgorithm.SchnorrkelSubstrate]: -1,
  },
  [Curve.SECP256R1]: {
    [SignatureAlgorithm.ECDSASecp256r1]: 0,
    [SignatureAlgorithm.ECDSASecp256k1]: -1,
    [SignatureAlgorithm.Taproot]: -1,
    [SignatureAlgorithm.EdDSA]: -1,
    [SignatureAlgorithm.SchnorrkelSubstrate]: -1,
  },
  [Curve.ED25519]: {
    [SignatureAlgorithm.EdDSA]: 0,
    [SignatureAlgorithm.ECDSASecp256k1]: -1,
    [SignatureAlgorithm.Taproot]: -1,
    [SignatureAlgorithm.ECDSASecp256r1]: -1,
    [SignatureAlgorithm.SchnorrkelSubstrate]: -1,
  },
  [Curve.RISTRETTO]: {
    [SignatureAlgorithm.SchnorrkelSubstrate]: 0,
    [SignatureAlgorithm.ECDSASecp256k1]: -1,
    [SignatureAlgorithm.Taproot]: -1,
    [SignatureAlgorithm.ECDSASecp256r1]: -1,
    [SignatureAlgorithm.EdDSA]: -1,
  },
};
const HASH_NUM: Record<
  Curve,
  Record<SignatureAlgorithm, Partial<Record<Hash, number>>>
> = {
  [Curve.SECP256K1]: {
    [SignatureAlgorithm.ECDSASecp256k1]: {
      [Hash.KECCAK256]: 0,
      [Hash.SHA256]: 1,
      [Hash.DoubleSHA256]: 2,
    },
    [SignatureAlgorithm.Taproot]: { [Hash.SHA256]: 0 },
    [SignatureAlgorithm.ECDSASecp256r1]: {},
    [SignatureAlgorithm.EdDSA]: {},
    [SignatureAlgorithm.SchnorrkelSubstrate]: {},
  },
  [Curve.SECP256R1]: {
    [SignatureAlgorithm.ECDSASecp256r1]: { [Hash.SHA256]: 0 },
    [SignatureAlgorithm.ECDSASecp256k1]: {},
    [SignatureAlgorithm.Taproot]: {},
    [SignatureAlgorithm.EdDSA]: {},
    [SignatureAlgorithm.SchnorrkelSubstrate]: {},
  },
  [Curve.ED25519]: {
    [SignatureAlgorithm.EdDSA]: { [Hash.SHA512]: 0 },
    [SignatureAlgorithm.ECDSASecp256k1]: {},
    [SignatureAlgorithm.Taproot]: {},
    [SignatureAlgorithm.ECDSASecp256r1]: {},
    [SignatureAlgorithm.SchnorrkelSubstrate]: {},
  },
  [Curve.RISTRETTO]: {
    [SignatureAlgorithm.SchnorrkelSubstrate]: { [Hash.Merlin]: 0 },
    [SignatureAlgorithm.ECDSASecp256k1]: {},
    [SignatureAlgorithm.Taproot]: {},
    [SignatureAlgorithm.ECDSASecp256r1]: {},
    [SignatureAlgorithm.EdDSA]: {},
  },
};

const DEFAULT_SIGN_BY_CURVE: Record<
  Curve,
  { sigAlgo: SignatureAlgorithm; hash: Hash }
> = {
  [Curve.SECP256K1]: { sigAlgo: SignatureAlgorithm.Taproot, hash: Hash.SHA256 },
  [Curve.SECP256R1]: {
    sigAlgo: SignatureAlgorithm.ECDSASecp256r1,
    hash: Hash.SHA256,
  },
  [Curve.ED25519]: { sigAlgo: SignatureAlgorithm.EdDSA, hash: Hash.SHA512 },
  [Curve.RISTRETTO]: {
    sigAlgo: SignatureAlgorithm.SchnorrkelSubstrate,
    hash: Hash.Merlin,
  },
};

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
function fmtMs(n: number): string {
  if (n < 1000) return `${n.toFixed(0)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

async function timed<T>(
  steps: Step[],
  name: string,
  cat: Category,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    const v = await fn();
    return v;
  } finally {
    steps.push({ name, ms: performance.now() - t0, cat });
  }
}

function loadEnv() {
  const apiKey = process.env.MPCKIT_API_KEY;
  if (!apiKey) throw new Error("MPCKIT_API_KEY required");
  const backendUrl = (
    process.env.BACKEND_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const network = (process.env.IKA_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";
  const seedHex = process.env.E2E_USER_SEED_HEX ?? "42".repeat(32);
  const stripped = seedHex.startsWith("0x") ? seedHex.slice(2) : seedHex;
  if (stripped.length !== 64)
    throw new Error("E2E_USER_SEED_HEX must be 32 bytes hex");
  const curve = (process.env.BENCH_CURVE ?? Curve.SECP256K1) as Curve;
  const signIters = Math.max(
    1,
    Number.parseInt(process.env.BENCH_SIGN_ITERS ?? "5", 10),
  );
  const seed = Uint8Array.from(Buffer.from(stripped, "hex"));
  // Per-curve seed so we don't reuse another curve's encryption-key
  // address (matches the matrix bench convention).
  const curveSeed = Uint8Array.from(
    createHash("sha256")
      .update(seed)
      .update(curve)
      .update("bench-detailed")
      .digest(),
  );
  return { apiKey, backendUrl, network, curve, seed: curveSeed, signIters };
}

interface OnboardOutcome {
  steps: Step[];
  totalMs: number;
  dwalletId: string;
  suiDwalletId: string;
  userSecretKeyShareHex: string;
  userPublicOutputHex: string;
  encryptedUserSecretKeyShareId: string;
  cryptoSessionId: string;
}

async function onboardWithBreakdown(
  api: MpcKit,
  ika: IkaClient,
  curve: Curve,
  seed: Uint8Array,
): Promise<OnboardOutcome> {
  const steps: Step[] = [];
  const t0 = performance.now();

  // 1. Crypto: derive key material from seed (Class-groups encryption
  //    key + Ed25519 signer). This is the dominant local-WASM cost.
  const session = await timed(
    steps,
    "openSession (key derivation)",
    "crypto",
    () => inlineCryptoEngine.openSession(seed, curve),
  );

  // 2. Crypto: sign encryption key bytes.
  const encKeySig = await timed(
    steps,
    "signEncryptionKey (Ed25519)",
    "crypto",
    () => inlineCryptoEngine.signEncryptionKey(session.id),
  );

  // 3. HTTP: register encryption key on chain (Move PTB executed by backend).
  const encryptionKey = await timed(
    steps,
    "POST /v1/encryption-keys (Move + DB)",
    "http-api",
    () =>
      api.raw.post<{ id: string }>("/v1/encryption-keys", {
        curve: CURVE_NUMBER[curve],
        encryptionKeyHex: session.encryptionKeyHex,
        encryptionKeySignatureHex: encKeySig.signatureHex,
        signerPublicKeyHex: session.signingPublicKeyHex,
      }),
  );

  // 4-5. Backend gives us operator address + latest encryption-key id
  //      (via /v1/network) plus protocol params (cached + boot-warmed,
  //      ~50ms hot vs ~11s via upstream Sui RPC). Issued in parallel
  //      to mirror MpcKit.onboard.
  const [networkInfo, ppBytes] = await Promise.all([
    timed(steps, "GET /v1/network", "http-api", () => api.networkInfo()),
    timed(steps, "GET /v1/protocol-parameters (backend)", "http-api", () =>
      api.protocolParameters(curve),
    ),
  ]);

  // 6. Crypto: WASM DKG (centralized output + encryption proof). Goes
  //    through the SDK's CryptoEngine which feeds prepareDKGAsync a
  //    stub IkaClient that returns the pre-fetched bytes — no upstream
  //    RPC roundtrip.
  const sessionIdBytes = randomBytes(32);
  const dkg = await timed(
    steps,
    "prepareDKG (WASM DKG via inlineCryptoEngine)",
    "crypto",
    () =>
      inlineCryptoEngine.prepareDKG(session.id, {
        sessionIdentifierHex: toHex(sessionIdBytes),
        protocolPublicParametersHex: toHex(ppBytes),
        networkEncryptionKeyId: networkInfo.latestEncryptionKey.id,
        senderAddress: networkInfo.operatorAddress,
      }),
  );

  // 7. HTTP: submit DKG PTB (backend Move call → coordinator session).
  const onboardRes = await timed(
    steps,
    "POST /v1/dwallets (Move + DB)",
    "http-api",
    () =>
      api.raw.post<{
        dwallet: { id: string; suiDwalletId: string };
        txDigest: string;
        encryptedUserSecretKeyShareId: string;
      }>("/v1/dwallets", {
        encryptionKeyId: encryptionKey.id,
        dwalletNetworkEncryptionKeyId: networkInfo.latestEncryptionKey.id,
        centralizedPublicKeyShareAndProofHex: dkg.userDKGMessageHex,
        encryptedCentralizedSecretShareAndProofHex:
          dkg.encryptedCentralizedSecretShareAndProofHex,
        userPublicOutputHex: dkg.userPublicOutputHex,
        signerPublicKeyHex: session.signingPublicKeyHex,
        sessionIdentifierHex: toHex(sessionIdBytes),
      }),
  );

  // 8. MPC wait: poll until coordinator finalises the dwallet to
  //    AwaitingKeyHolderSignature.
  const awaitingDw = await timed(
    steps,
    "MPC wait: coordinator → AwaitingKeyHolderSignature",
    "mpc-wait",
    () =>
      ika.getDWalletInParticularState(
        onboardRes.dwallet.suiDwalletId,
        "AwaitingKeyHolderSignature",
        {
          timeout: 600_000,
          interval: 2_000,
        },
      ),
  );

  const dwalletPublicOutput = new Uint8Array(
    (
      awaitingDw.state as {
        AwaitingKeyHolderSignature: { public_output: number[] };
      }
    ).AwaitingKeyHolderSignature.public_output,
  );

  // 9. Crypto: sign dwallet's public output.
  const userOutSig = await timed(
    steps,
    "signUserOutput (Ed25519 over public_output)",
    "crypto",
    () =>
      inlineCryptoEngine.signUserOutput(session.id, {
        dwalletPublicOutputHex: toHex(dwalletPublicOutput),
        userPublicOutputHex: dkg.userPublicOutputHex,
      }),
  );

  // 10. HTTP: accept the user share (final Move tx).
  const accept = await timed(
    steps,
    "POST /v1/dwallets/:id/accept (Move + DB)",
    "http-api",
    () =>
      api.raw.post<{ dwallet: { id: string; suiDwalletId: string } }>(
        `/v1/dwallets/${encodeURIComponent(onboardRes.dwallet.id)}/accept`,
        {
          encryptedUserSecretKeyShareId:
            onboardRes.encryptedUserSecretKeyShareId,
          userOutputSignatureHex: userOutSig.signatureHex,
        },
      ),
  );

  return {
    steps,
    totalMs: performance.now() - t0,
    dwalletId: accept.dwallet.id,
    suiDwalletId: accept.dwallet.suiDwalletId,
    userSecretKeyShareHex: dkg.userSecretKeyShareHex,
    userPublicOutputHex: dkg.userPublicOutputHex,
    encryptedUserSecretKeyShareId: onboardRes.encryptedUserSecretKeyShareId,
    cryptoSessionId: session.id,
  };
}

interface SignOutcome {
  steps: Step[];
  totalMs: number;
  signatureHex: string;
}

async function signWithBreakdown(
  api: MpcKit,
  ika: IkaClient,
  args: {
    curve: Curve;
    sigAlgo: SignatureAlgorithm;
    hash: Hash;
    dwalletId: string;
    suiDwalletId: string;
    userSecretKeyShareHex: string;
    cryptoSessionId: string;
    iter: number;
  },
): Promise<SignOutcome> {
  const steps: Step[] = [];
  const t0 = performance.now();

  const idem = `bench-${args.iter}-${randomBytes(8).toString("hex")}`;
  const message = new Uint8Array(32);
  message.set(new TextEncoder().encode(`bench-${args.iter}-${Date.now()}`));

  const sigAlgoNum = SIGN_NUM[args.curve][args.sigAlgo];
  const hashNum = HASH_NUM[args.curve][args.sigAlgo][args.hash];
  if (sigAlgoNum < 0 || hashNum === undefined) {
    throw new Error(
      `unsupported sign combo for ${args.curve}/${args.sigAlgo}/${args.hash}`,
    );
  }

  // 1. HTTP: phase 1 — allocate presign + return its bytes.
  const prepared = await timed(
    steps,
    "POST /v1/sign (phase 1: prepare)",
    "http-api",
    () =>
      api.raw.post<{
        signRequest: { id: string };
        duplicate: boolean;
        presignBytesHex: string;
        presignSuiObjectId: string;
      }>(
        "/v1/sign",
        {
          dwalletId: args.dwalletId,
          signatureAlgorithm: sigAlgoNum,
          hashScheme: hashNum,
          messageHex: toHex(message),
        },
        { idempotencyKey: idem },
      ),
  );

  // 2. Active dwallet (chain state polling) + protocol params from
  //    the backend's cached endpoint, run in parallel to mirror the
  //    SDK's actual code path.
  const [activeDw, ppBytes] = await Promise.all([
    timed(steps, "ika.getDWalletInParticularState (Active)", "ika-rpc", () =>
      ika.getDWalletInParticularState(args.suiDwalletId, "Active", {
        timeout: 60_000,
        interval: 1_000,
      }),
    ),
    timed(steps, "GET /v1/protocol-parameters (backend)", "http-api", () =>
      api.protocolParameters(args.curve),
    ),
  ]);
  const dwalletPublicOutput = new Uint8Array(
    (activeDw.state as { Active: { public_output: number[] } }).Active
      .public_output,
  );

  // 3. Crypto: WASM centralised signature (binds user share + presign + message).
  const centralizedSig = await timed(
    steps,
    "signCentralizedMessage (WASM via inlineCryptoEngine)",
    "crypto",
    () =>
      inlineCryptoEngine.signCentralizedMessage(args.cryptoSessionId, {
        signatureAlgorithm: args.sigAlgo,
        hash: args.hash,
        protocolPublicParametersHex: toHex(ppBytes),
        userPublicOutputHex: toHex(dwalletPublicOutput),
        userSecretKeyShareHex: args.userSecretKeyShareHex,
        presignBytesHex: prepared.presignBytesHex,
        messageHex: toHex(message),
      }),
  );

  // 4. HTTP: phase 2 — submit centralised sig, queues the worker.
  const sessionIdBytes = randomBytes(32);
  await timed(steps, "POST /v1/sign/:id/submit (phase 2)", "http-api", () =>
    api.raw.post<{ signRequest: { id: string } }>(
      `/v1/sign/${encodeURIComponent(prepared.signRequest.id)}/submit`,
      {
        messageCentralizedSignatureHex: centralizedSig.signatureHex,
        sessionIdentifierHex: toHex(sessionIdBytes),
      },
    ),
  );

  // 5. MPC wait: poll backend until it reports completed (worker submits
  //    Move + waits for coordinator → Completed).
  const final = await timed(
    steps,
    "MPC wait: GET /v1/sign/:id → completed",
    "mpc-wait",
    async () => {
      const start = performance.now();
      while (performance.now() - start < 240_000) {
        const res = await api.raw.get<{
          signRequest: { status: string; signatureHex?: string | null };
        }>(`/v1/sign/${encodeURIComponent(prepared.signRequest.id)}`);
        if (res.signRequest.status === "completed") return res.signRequest;
        if (res.signRequest.status === "failed") {
          throw new Error(`sign failed: ${JSON.stringify(res.signRequest)}`);
        }
        await new Promise((r) => setTimeout(r, 1_500));
      }
      throw new Error("sign did not complete in 240s");
    },
  );

  return {
    steps,
    totalMs: performance.now() - t0,
    signatureHex: final.signatureHex ?? "",
  };
}

function summarisePerStep(
  rows: Step[][],
): Map<string, { cat: Category; samples: number[] }> {
  const out = new Map<string, { cat: Category; samples: number[] }>();
  for (const steps of rows) {
    for (const s of steps) {
      const entry = out.get(s.name);
      if (entry) entry.samples.push(s.ms);
      else out.set(s.name, { cat: s.cat, samples: [s.ms] });
    }
  }
  return out;
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function p50(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function printBreakdown(label: string, rows: Step[][]): void {
  console.error(`\n[bench] === ${label} (n=${rows.length}) ===`);
  const summary = summarisePerStep(rows);
  const total =
    rows.length === 0
      ? 0
      : avg(rows.map((s) => s.reduce((acc, x) => acc + x.ms, 0)));
  // Print steps in the order they appear in the first run so the timeline reads naturally.
  const orderedNames = rows[0]?.map((s) => s.name) ?? [];
  // Column widths for readable alignment.
  const nameW = Math.max(50, ...orderedNames.map((n) => n.length + 2));
  const catTotals: Record<Category, number> = {
    crypto: 0,
    "http-api": 0,
    "ika-rpc": 0,
    "mpc-wait": 0,
  };
  for (const name of orderedNames) {
    const e = summary.get(name);
    if (!e) continue;
    const a = avg(e.samples);
    catTotals[e.cat] += a;
    const pct = total === 0 ? 0 : (a / total) * 100;
    console.error(
      `  [${e.cat.padEnd(8)}] ${name.padEnd(nameW)} avg=${fmtMs(a).padEnd(8)} p50=${fmtMs(p50(e.samples)).padEnd(8)}  ${pct.toFixed(1)}%`,
    );
  }
  console.error(
    "  ────────────────────────────────────────────────────────────",
  );
  for (const [cat, ms] of Object.entries(catTotals) as [Category, number][]) {
    const pct = total === 0 ? 0 : (ms / total) * 100;
    console.error(
      `  ${cat.padEnd(10)} subtotal: ${fmtMs(ms).padEnd(8)} (${pct.toFixed(1)}%)`,
    );
  }
  console.error(`  total avg: ${fmtMs(total)}`);
}

async function main() {
  const env = loadEnv();
  const api = new MpcKit({
    baseUrl: env.backendUrl,
    apiKey: env.apiKey,
    network: env.network,
  });
  const ika = new IkaClient({
    suiClient: new SuiGrpcClient({
      network: env.network,
      baseUrl:
        env.network === "mainnet"
          ? "https://fullnode.mainnet.sui.io:443"
          : "https://fullnode.testnet.sui.io:443",
    }),
    config: getNetworkConfig(env.network),
    cache: true,
  });
  await ika.initialize();

  console.error(
    `[bench] curve=${env.curve} signIters=${env.signIters} backend=${env.backendUrl}`,
  );
  const startBalance = await api.balance();
  console.error(`[bench] balance: $${startBalance.creditsUsd}`);

  const onboard = await onboardWithBreakdown(api, ika, env.curve, env.seed);
  console.error(
    `[bench] onboard total: ${fmtMs(onboard.totalMs)} (dwallet=${onboard.dwalletId})`,
  );

  const { sigAlgo, hash } = DEFAULT_SIGN_BY_CURVE[env.curve];
  const signRuns: Step[][] = [];
  for (let i = 1; i <= env.signIters; i++) {
    try {
      const r = await signWithBreakdown(api, ika, {
        curve: env.curve,
        sigAlgo,
        hash,
        dwalletId: onboard.dwalletId,
        suiDwalletId: onboard.suiDwalletId,
        userSecretKeyShareHex: onboard.userSecretKeyShareHex,
        cryptoSessionId: onboard.cryptoSessionId,
        iter: i,
      });
      console.error(`[bench] sign #${i}: ${fmtMs(r.totalMs)}`);
      signRuns.push(r.steps);
    } catch (err) {
      const code = err instanceof MpcKitError ? err.code : "UNKNOWN";
      console.error(
        `[bench] sign #${i} failed (${code}): ${String(err).slice(0, 200)}`,
      );
      if (err instanceof MpcKitError && err.code === "PRESIGN_POOL_EMPTY") {
        console.error("[bench] cooling down 80s for refill…");
        await new Promise((r) => setTimeout(r, 80_000));
      }
    }
  }

  printBreakdown("onboard", [onboard.steps]);
  if (signRuns.length > 0)
    printBreakdown(`sign (${env.curve}, ${sigAlgo}, ${hash})`, signRuns);

  const endBalance = await api.balance();
  console.error(
    `\n[bench] balance: $${startBalance.creditsUsd} -> $${endBalance.creditsUsd}`,
  );

  console.log(
    JSON.stringify(
      {
        curve: env.curve,
        sigAlgo,
        hash,
        signIters: env.signIters,
        onboard: {
          totalMs: onboard.totalMs,
          steps: onboard.steps,
        },
        sign: signRuns.map((rows) => ({
          totalMs: rows.reduce((a, x) => a + x.ms, 0),
          steps: rows,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[bench] fatal:", err);
  process.exit(1);
});
