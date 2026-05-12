/**
 * Browser-side smoke. Routes the heavy DKG / sign crypto through a
 * Web Worker so the main thread stays responsive while WASM runs.
 *
 * To use a real seed, pull bytes from a passkey PRF (`@simplewebauthn`
 * or the WebAuthn API directly). The constant below is for demo only.
 */
import {
  Curve,
  createWebWorkerCryptoEngine,
  Hash,
  MPCKit,
  SignatureAlgorithm,
} from "@mpckit/sdk";

const log = (msg: string) => {
  const el = document.getElementById("log");
  if (el) el.textContent += `${msg}\n`;
  // eslint-disable-next-line no-console
  console.log(msg);
};

async function main() {
  const baseUrl = (import.meta.env.VITE_MPCKIT_BASE_URL as string) ?? "";
  const apiKey = (import.meta.env.VITE_MPCKIT_API_KEY as string) ?? "";
  if (!baseUrl || !apiKey) {
    log(
      "set VITE_MPCKIT_BASE_URL and VITE_MPCKIT_API_KEY in .env.local before running",
    );
    return;
  }

  // Spin up the Web Worker. Vite resolves the URL at build time; other
  // bundlers do the same `new URL(..., import.meta.url)` dance.
  const worker = new Worker(
    new URL("@mpckit/sdk/worker-impl", import.meta.url),
    { type: "module" },
  );
  const crypto = createWebWorkerCryptoEngine(worker);

  const api = new MPCKit({
    baseUrl,
    apiKey,
    network: "testnet",
    crypto,
  });

  const seed = new Uint8Array(32).fill(0x42);

  const balance = await api.balance();
  log(`balance: ${balance.creditsMicro} micro-credits`);

  log("onboard …");
  const onboard = await api.onboard({ seed, curve: Curve.SECP256K1 });
  log(`dwallet: ${onboard.dwallet.suiDwalletId}`);

  log("sign …");
  const message = new TextEncoder().encode("hello, ika browser");
  const result = await api.sign({
    seed,
    dwalletId: onboard.dwallet.id,
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.Taproot,
    hashScheme: Hash.SHA256,
    message,
    userSecretKeyShareHex: onboard.userSecretKeyShareHex,
    userPublicOutputHex: onboard.userPublicOutputHex,
  });
  log(
    `signature: ${Array.from(result.signature)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`,
  );
}

main().catch((err) => log(`error: ${(err as Error).message}`));
