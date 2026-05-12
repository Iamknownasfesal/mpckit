/**
 * Publish the `mpckitcore` Move package to testnet or mainnet and
 * extract the IDs the backend needs:
 *
 *   MPCKITCORE_<NETWORK>_PACKAGE_ID
 *   MPCKITCORE_<NETWORK>_ADMIN_CAP_ID
 *   MPCKITCORE_<NETWORK>_OPERATOR_CAP_ID
 *   MPCKITCORE_<NETWORK>_TREASURY_ID
 *
 * Required env:
 *   IKA_NETWORK                       testnet | mainnet  (default testnet)
 *   SUI_KEYPAIR or
 *   HOT_WALLET_SUI_SECRET_HEX         32-byte hex (no 0x) — same key the
 *                                     backend boots with.
 *
 * Optional:
 *   SUI_GRPC_URL                      RPC override (default: Mysten fullnode)
 *
 * Build-side: the `ika` and `ika_dwallet_2pc_mpc` deps in Move.toml are
 * pinned per network. This script rewrites those `deployed_contracts/…`
 * paths to match `IKA_NETWORK` before `sui move build` and restores the
 * file on exit so the working tree stays clean.
 *
 * Usage:
 *   IKA_NETWORK=mainnet bun run apps/backend/scripts/deploy.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_DIR = resolve(
  import.meta.dir,
  "../../../packages/mpckitcore_move",
);
const MOVE_TOML = resolve(PACKAGE_DIR, "Move.toml");

interface BuildOutput {
  modules: string[];
  dependencies: string[];
  digest: number[];
}

function loadKeypair(): Ed25519Keypair {
  const bech32 = process.env.SUI_KEYPAIR;
  if (bech32) {
    const decoded = decodeSuiPrivateKey(bech32);
    if (decoded.scheme !== "ED25519") {
      throw new Error(`expected ED25519 keypair, got ${decoded.scheme}`);
    }
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  }
  const hex = process.env.HOT_WALLET_SUI_SECRET_HEX;
  if (hex) {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length !== 64) {
      throw new Error("HOT_WALLET_SUI_SECRET_HEX must be 32 bytes hex");
    }
    return Ed25519Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(stripped, "hex")),
    );
  }
  throw new Error("set SUI_KEYPAIR (bech32) or HOT_WALLET_SUI_SECRET_HEX");
}

// Real published original_package addresses, copied from
// @ika.xyz/sdk's getNetworkConfig(network). The upstream
// deployed_contracts/<network>/<pkg>/Move.toml ships with placeholder
// 0x0 addresses, so we override them in our own [addresses] block —
// otherwise `sui move build` rejects with "unpublished dependencies".
//
// These are the *original* package ids, not the upgraded ones. Move
// type identity is keyed on the first publish address.
const IKA_ADDRESSES = {
  testnet: {
    ika: "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a",
    ika_common:
      "0x96fc75633b6665cf84690587d1879858ff76f88c10c945e299f90bf4e0985eb0",
    ika_dwallet_2pc_mpc:
      "0xf02f5960c94fce1899a3795b5d11fd076bc70a8d0e20a2b19923d990ed490730",
  },
  mainnet: {
    ika: "0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa",
    ika_common:
      "0x9e1e9f8e4e51ee2421a8e7c0c6ab3ef27c337025d15333461b72b1b813c44175",
    ika_dwallet_2pc_mpc:
      "0xdd24c62739923fbf582f49ef190b4a007f981ca6eb209ca94f3a8eaf7c611317",
  },
} as const;

// Rewrite Move.toml in place for the requested network:
//   1. Repoint the ika + ika_dwallet_2pc_mpc git deps to the
//      network's deployed_contracts subdir.
//   2. Append an [addresses] block with the actual on-chain package
//      ids so the build doesn't see them as 0x0.
//
// Returns the original file contents so the caller can restore it.
function swapDepsForNetwork(network: "testnet" | "mainnet"): string {
  const original = readFileSync(MOVE_TOML, "utf-8");
  const a = IKA_ADDRESSES[network];

  // Strip any [addresses] block we wrote on a previous run, then write
  // a fresh one — keeps the toml deterministic regardless of starting
  // state.
  const withoutAddresses = original
    .replace(/\[addresses\][\s\S]*$/m, "")
    .trimEnd();
  const withDepSwap = withoutAddresses
    .replace(
      /subdir = "deployed_contracts\/(testnet|mainnet)\/ika_dwallet_2pc_mpc"/g,
      `subdir = "deployed_contracts/${network}/ika_dwallet_2pc_mpc"`,
    )
    .replace(
      /subdir = "deployed_contracts\/(testnet|mainnet)\/ika"/g,
      `subdir = "deployed_contracts/${network}/ika"`,
    );

  const addresses = [
    "",
    "[addresses]",
    `mpckitcore = "0x0"`,
    `ika = "${a.ika}"`,
    `ika_common = "${a.ika_common}"`,
    `ika_dwallet_2pc_mpc = "${a.ika_dwallet_2pc_mpc}"`,
    "",
  ].join("\n");

  writeFileSync(MOVE_TOML, `${withDepSwap}\n${addresses}`);
  return original;
}

// Patch the cached ika dep Move.toml files to set published-at +
// fill the [addresses] block. Without this, sui considers them
// unpublished and rejects the publish.
function patchCachedIkaDeps(network: "testnet" | "mainnet"): void {
  const a = IKA_ADDRESSES[network];
  const cacheRoot = resolve(homedir(), ".move", "git");
  if (!existsSync(cacheRoot)) return;
  const ikaRevDirs = readdirSync(cacheRoot).filter((d) =>
    d.startsWith("https___github_com_dwallet-labs_ika_git_"),
  );
  for (const dir of ikaRevDirs) {
    for (const [pkg, addr] of Object.entries(a)) {
      const tomlPath = resolve(
        cacheRoot,
        dir,
        "deployed_contracts",
        network,
        pkg,
        "Move.toml",
      );
      if (!existsSync(tomlPath)) continue;
      const original = readFileSync(tomlPath, "utf-8");
      const lines = original.split("\n");
      let inPackage = false;
      let publishedAtSet = false;
      let inAddresses = false;
      const out: string[] = [];
      for (const line of lines) {
        // Section header detection
        if (/^\[package\]\s*$/.test(line)) {
          inPackage = true;
          inAddresses = false;
          out.push(line);
          continue;
        }
        if (/^\[addresses\]\s*$/.test(line)) {
          // If we left [package] without a published-at, inject one
          // before the [addresses] header.
          if (inPackage && !publishedAtSet) {
            out.push(`published-at = "${addr}"`);
            publishedAtSet = true;
          }
          inPackage = false;
          inAddresses = true;
          out.push(line);
          continue;
        }
        if (/^\[[^\]]+\]\s*$/.test(line)) {
          if (inPackage && !publishedAtSet) {
            out.push(`published-at = "${addr}"`);
            publishedAtSet = true;
          }
          inPackage = false;
          inAddresses = false;
          out.push(line);
          continue;
        }
        // Within [package]: replace any existing published-at.
        if (inPackage && /^\s*published-at\s*=/.test(line)) {
          out.push(`published-at = "${addr}"`);
          publishedAtSet = true;
          continue;
        }
        // Within [addresses]: replace `<pkg> = "0x0"` with the real
        // address.
        if (inAddresses) {
          const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"0x0"\s*$/);
          if (m && m[1] === pkg) {
            out.push(`${pkg} = "${addr}"`);
            continue;
          }
        }
        out.push(line);
      }
      // Trailing [package] (file ended without another section header).
      if (inPackage && !publishedAtSet) {
        out.push(`published-at = "${addr}"`);
      }
      const patched = out.join("\n");
      if (patched !== original) {
        writeFileSync(tomlPath, patched);
        console.error(
          `[deploy] patched ${dir.slice(-12)}/.../${network}/${pkg}/Move.toml`,
        );
      }
    }
  }
}

// Poll core.getTransaction until effects are visible. Mainnet's
// fullnode sometimes lags by a few hundred ms behind submission so
// signAndExecuteTransaction returns before local execution lands.
async function pollForEffects(
  client: SuiJsonRpcClient,
  digest: string,
  timeoutMs = 60_000,
): Promise<{
  digest: string;
  effects?: { status: string; changedObjects: unknown[] } & Record<
    string,
    unknown
  >;
  objectTypes?: Record<string, string>;
}> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await client.core.getTransaction({
        digest,
        include: { effects: true, objectTypes: true },
      });
      const txn = (r as { Transaction?: unknown }).Transaction ?? r;
      if ((txn as { effects?: { status?: string } })?.effects?.status) {
        return txn as Awaited<ReturnType<typeof pollForEffects>>;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(
    `timeout waiting for effects on ${digest}: ${String(lastErr)}`,
  );
}

function buildPackage(opts?: { allowDirty?: boolean }): BuildOutput {
  const args = [
    "move",
    "build",
    "--dump-bytecode-as-base64",
    "--path",
    PACKAGE_DIR,
  ];
  if (opts?.allowDirty) args.push("--allow-dirty");
  const out = execFileSync("sui", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out) as BuildOutput;
}

// The active `sui` CLI env drives both dep tree-shaking RPC lookups
// during build AND any client commands. For a mainnet publish the
// active env has to be mainnet, otherwise sui tries to fetch mainnet
// package objects against the testnet fullnode and 404s. Switch
// around the build and restore on exit.
function currentSuiEnv(): string {
  return execFileSync("sui", ["client", "active-env"], {
    encoding: "utf-8",
  }).trim();
}

function switchSuiEnv(env: string): void {
  execFileSync("sui", ["client", "switch", "--env", env], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function main() {
  const network = (process.env.IKA_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";
  const url = process.env.SUI_GRPC_URL ?? getJsonRpcFullnodeUrl(network);
  const kp = loadKeypair();
  const sender = kp.toSuiAddress();

  console.error(`[deploy] network=${network} sender=${sender}`);

  const originalToml = swapDepsForNetwork(network);
  const previousEnv = currentSuiEnv();
  const needsSwitch = previousEnv !== network;
  if (needsSwitch) {
    console.error(`[deploy] switching sui env: ${previousEnv} → ${network}`);
    switchSuiEnv(network);
  }
  let build: BuildOutput;
  try {
    // First build resolves git deps into ~/.move/git/...; second build
    // (after patching) actually compiles against the real addresses.
    console.error(`[deploy] resolving deps for ${network}…`);
    try {
      buildPackage();
    } catch {
      // Expected to fail on "unpublished dependencies" — the deps have
      // landed in cache and that's all we needed. Patch them next.
    }
    patchCachedIkaDeps(network);
    console.error(`[deploy] building ${PACKAGE_DIR}…`);
    build = buildPackage({ allowDirty: true });
  } finally {
    writeFileSync(MOVE_TOML, originalToml);
    if (needsSwitch) {
      console.error(`[deploy] restoring sui env → ${previousEnv}`);
      switchSuiEnv(previousEnv);
    }
  }
  console.error(
    `[deploy] built ${build.modules.length} module(s); deps=${build.dependencies.length}`,
  );

  const client = new SuiJsonRpcClient({ url, network });

  const tx = new Transaction();
  tx.setSender(sender);
  const upgradeCap = tx.publish({
    modules: build.modules,
    dependencies: build.dependencies,
  });
  tx.transferObjects([upgradeCap], tx.pure.address(sender));

  console.error("[deploy] submitting publish tx…");
  const submit = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: kp,
    include: { effects: true, objectTypes: true },
  });
  // The submit response sometimes lands before local execution finishes
  // (mainnet validator quorum vs local execution race). In that case
  // `$kind` is neither "Transaction" nor "FailedTransaction"; we just
  // have the digest and need to poll for effects.
  const digest =
    submit.$kind === "Transaction"
      ? submit.Transaction.digest
      : submit.$kind === "FailedTransaction"
        ? submit.FailedTransaction.transactionDigest
        : (submit as { digest?: string }).digest;
  if (!digest) {
    console.error("[deploy] unexpected submit response shape:");
    console.error(JSON.stringify(submit, null, 2));
    throw new Error("publish: no digest on submit response");
  }
  console.error(`[deploy] tx digest: ${digest}; waiting for effects…`);
  const fetched = await pollForEffects(client, digest);
  const txn = fetched;
  const effects = txn.effects;
  const types = txn.objectTypes ?? {};
  if (!effects) throw new Error("no effects on publish response");
  if (effects.status !== "Success") {
    console.error("[deploy] tx effects:");
    console.error(JSON.stringify(effects, null, 2));
    throw new Error(`publish failed: status ${effects.status}`);
  }

  const created = effects.changedObjects.filter(
    (o) => o.idOperation === "Created",
  );

  const findOne = (substr: string): string => {
    const matches = created
      .filter((o) => (types[o.objectId] ?? "").includes(substr))
      .map((o) => o.objectId);
    if (matches.length === 0) {
      throw new Error(`no created object matched "${substr}"`);
    }
    if (matches.length > 1) {
      console.warn(
        `[deploy] multiple objects matched "${substr}": ${matches.join(", ")}; using first`,
      );
    }
    return matches[0]!;
  };

  const packageId = (() => {
    for (const o of created) {
      if (!types[o.objectId]) return o.objectId;
    }
    throw new Error("could not locate published package id in effects");
  })();

  const adminCapId = findOne("::acl::AdminCap");
  const operatorCapId = findOne("::acl::OperatorCap");
  const treasuryId = findOne("::treasury::Treasury");

  const tag = network.toUpperCase();
  console.log("");
  console.log("# === paste into apps/backend/.env ===");
  console.log(`MPCKITCORE_${tag}_PACKAGE_ID=${packageId}`);
  console.log(`MPCKITCORE_${tag}_ADMIN_CAP_ID=${adminCapId}`);
  console.log(`MPCKITCORE_${tag}_OPERATOR_CAP_ID=${operatorCapId}`);
  console.log(`MPCKITCORE_${tag}_TREASURY_ID=${treasuryId}`);
  console.log("");
  console.error(`[deploy] tx digest: ${txn.digest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
