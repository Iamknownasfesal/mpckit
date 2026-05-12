/**
 * Minimal Node-side example. Uses the inline crypto engine, which
 * runs in the calling thread, fine for a CLI / backend integration.
 *
 *   bun install
 *   MPCKIT_API_KEY=mpckit_test_... \
 *   bun run start
 *
 * Set MPCKIT_BASE_URL only if you're self-hosting; otherwise the SDK
 * picks the hosted endpoint for the chosen network.
 */
import { Curve, Hash, MPCKit, SignatureAlgorithm } from "@mpckit/sdk";

async function main() {
  const apiKey = required("MPCKIT_API_KEY");
  const baseUrl = process.env.MPCKIT_BASE_URL;
  const seedHex = process.env.MPCKIT_SEED_HEX ?? "42".repeat(32);
  const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));

  const api = new MPCKit({
    apiKey,
    network: "testnet",
    ...(baseUrl ? { baseUrl } : {}),
  });

  const balance = await api.balance();
  console.log("balance:", balance.creditsMicro, "micro-credits");

  const onboard = await api.onboard({ seed, curve: Curve.SECP256K1 });
  console.log("dwallet:", onboard.dwallet.suiDwalletId);

  const message = new TextEncoder().encode("hello, ika");
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
  console.log("signature:", Buffer.from(result.signature).toString("hex"));
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
