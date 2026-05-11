import {
  listEncryptionKeys,
  registerEncryptionKey,
} from "@/features/encryption-keys/service";
import { requestNetwork, requireAuth } from "@/http/middleware/auth";
/**
 *   POST /v1/encryption-keys   register a class-groups encryption key
 *   GET  /v1/encryption-keys   list this user's registered keys
 */
import { Elysia, t } from "elysia";

const HEX = /^[0-9a-fA-F]+$/;

function fromHex(s: string): Uint8Array {
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (!HEX.test(stripped)) {
    throw new Error("expected hex string");
  }
  return Uint8Array.from(Buffer.from(stripped, "hex"));
}

export const encryptionKeyRoutes = new Elysia({ prefix: "/v1" })
  .get(
    "/encryption-keys",
    async ({ request }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const rows = await listEncryptionKeys(user.id, network);
      return {
        network,
        keys: rows.map((r) => ({
          id: r.id,
          curve: r.curve,
          suiObjectId: r.suiObjectId,
          suiAddress: r.suiAddress,
          suiTxDigest: r.suiTxDigest,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
    {
      detail: {
        tags: ["encryption-keys"],
        summary: "List encryption keys",
        description:
          "All class-groups encryption keys the authenticated account has registered with the Ika coordinator. Each row carries the on-chain `suiObjectId`, owning Sui address, and registration tx digest. SDKs need the on-chain `suiObjectId` (used as `encryptionKeyId` when onboarding a dWallet).",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/encryption-keys",
    async ({ request, body }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const row = await registerEncryptionKey({
        userId: user.id,
        network,
        curve: body.curve,
        encryptionKey: fromHex(body.encryptionKeyHex),
        encryptionKeySignature: fromHex(body.encryptionKeySignatureHex),
        signerPublicKey: fromHex(body.signerPublicKeyHex),
      });
      return {
        id: row.id,
        network,
        curve: row.curve,
        suiObjectId: row.suiObjectId,
        suiAddress: row.suiAddress,
        suiTxDigest: row.suiTxDigest,
      };
    },
    {
      body: t.Object({
        curve: t.Integer({ minimum: 0, maximum: 3 }),
        encryptionKeyHex: t.String({ minLength: 2, maxLength: 8192 }),
        encryptionKeySignatureHex: t.String({ minLength: 128, maxLength: 256 }),
        signerPublicKeyHex: t.String({ minLength: 64, maxLength: 66 }),
      }),
      detail: {
        tags: ["encryption-keys"],
        summary: "Register encryption key",
        description:
          "Posts a class-groups encryption key + Ed25519 ownership proof to the Ika coordinator on Sui. The SDK derives the encryption key locally from a `UserShareEncryptionKeys` seed; the operator pays gas and brokers the registration PTB. The returned `suiObjectId` is the `encryptionKeyId` to pass into `POST /v1/dwallets`. Idempotent on `(curve, encryptionKey)`: re-registering the same key returns the existing row.",
        security: [{ bearer: [] }],
      },
    },
  );
