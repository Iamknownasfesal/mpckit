/**
 *   POST /v1/dwallets               create a new dwallet (zero-trust DKG;
 *                                    creates the user's account if needed)
 *   POST /v1/dwallets/:id/accept    finalize via accept_user_share
 *   GET  /v1/dwallets               list this user's dwallets
 *   GET  /v1/dwallets/:id           one dwallet
 *   GET  /v1/dwallets/:id/onchain-state?status=…   the on-chain dwallet
 *                                    state (polls Sui until the dwallet
 *                                    reaches the requested status; the
 *                                    Rust SDK can't talk to Sui gRPC
 *                                    cheaply so we proxy through here)
 */
import { Elysia, t } from "elysia";
import {
  acceptUserShare,
  fetchDwalletOnchainState,
  getDwalletForUser,
  listDwalletsForUser,
  onboardZeroTrust,
} from "@/features/dwallets/service";
import { requestNetwork, requireAuth } from "@/http/middleware/auth";
import type { DWallet } from "@/shared/db/schema";
import { errors } from "@/shared/errors";

const HEX = /^[0-9a-fA-F]+$/;

function fromHex(s: string): Uint8Array {
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (!HEX.test(stripped)) {
    throw errors.validation("expected hex string", "BAD_HEX");
  }
  return Uint8Array.from(Buffer.from(stripped, "hex"));
}

function publicDwallet(d: DWallet) {
  return {
    id: d.id,
    network: d.network,
    accountId: d.accountId,
    suiDwalletId: d.suiDwalletId,
    curve: d.curve,
    kind: d.kind,
    status: d.status,
    encryptionKeyId: d.encryptionKeyId,
    dkgTxDigest: d.dkgTxDigest,
    acceptTxDigest: d.acceptTxDigest,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export const dwalletRoutes = new Elysia({ prefix: "/v1" })
  .post(
    "/dwallets",
    async ({ request, body }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const result = await onboardZeroTrust({
        userId: user.id,
        network,
        encryptionKeyId: body.encryptionKeyId,
        dwalletNetworkEncryptionKeyId: body.dwalletNetworkEncryptionKeyId,
        centralizedPublicKeyShareAndProof: fromHex(
          body.centralizedPublicKeyShareAndProofHex,
        ),
        encryptedCentralizedSecretShareAndProof: fromHex(
          body.encryptedCentralizedSecretShareAndProofHex,
        ),
        userPublicOutput: fromHex(body.userPublicOutputHex),
        signerPublicKey: fromHex(body.signerPublicKeyHex),
        sessionIdentifierBytes: fromHex(body.sessionIdentifierHex),
      });
      return {
        account: result.account,
        dwallet: publicDwallet(result.dwallet),
        txDigest: result.txDigest,
        encryptedUserSecretKeyShareId: result.encryptedUserSecretKeyShareId,
      };
    },
    {
      body: t.Object({
        encryptionKeyId: t.String({ format: "uuid" }),
        dwalletNetworkEncryptionKeyId: t.String({
          minLength: 1,
          maxLength: 200,
        }),
        centralizedPublicKeyShareAndProofHex: t.String({ minLength: 2 }),
        encryptedCentralizedSecretShareAndProofHex: t.String({ minLength: 2 }),
        userPublicOutputHex: t.String({ minLength: 2 }),
        signerPublicKeyHex: t.String({ minLength: 64, maxLength: 66 }),
        sessionIdentifierHex: t.String({ minLength: 64, maxLength: 64 }),
      }),
      detail: {
        tags: ["dwallets"],
        summary: "Onboard zero-trust dWallet",
        description:
          "Submits a prepared DKG bundle to Ika's coordinator on Sui and persists the resulting dWallet under the caller's account. The SDK runs DKG locally (class-groups encryption + zk proofs) and posts the cryptographic outputs here; the operator pays gas and brokers the Sui PTB. Returns the dWallet row, the DKG tx digest, and the on-chain `encryptedUserSecretKeyShareId` the caller must echo back to `/accept` once the dWallet reaches `AwaitingKeyHolderSignature`. Idempotent on `sessionIdentifier`: re-posting the same identifier returns the original dWallet rather than re-running DKG.",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/dwallets/:id/accept",
    async ({ request, params, body }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const updated = await acceptUserShare({
        userId: user.id,
        network,
        dwalletId: params.id,
        encryptedUserSecretKeyShareId: body.encryptedUserSecretKeyShareId,
        userOutputSignature: fromHex(body.userOutputSignatureHex),
      });
      return { dwallet: publicDwallet(updated) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        encryptedUserSecretKeyShareId: t.String({
          minLength: 1,
          maxLength: 200,
        }),
        userOutputSignatureHex: t.String({ minLength: 128, maxLength: 256 }),
      }),
      detail: {
        tags: ["dwallets"],
        summary: "Accept user share",
        description:
          "Submits the caller-signed acceptance of the encrypted user secret-key share, transitioning the dWallet from `AwaitingKeyHolderSignature` to `Active`. Required after `POST /v1/dwallets`: the SDK derives the user-output signature locally with the caller's user-share key, posts it here, and the operator brokers the Sui PTB. Returns the updated dWallet row including the accept tx digest. Safe to retry: once the dWallet is `Active` further calls are no-ops.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/dwallets",
    async ({ request }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const rows = await listDwalletsForUser(user.id, network);
      return { network, dwallets: rows.map(publicDwallet) };
    },
    {
      detail: {
        tags: ["dwallets"],
        summary: "List dWallets",
        description:
          "All dWallets owned by the authenticated account, in creation order. Each row includes the on-chain `suiDwalletId`, current status (`AwaitingKeyHolderSignature`, `Active`, etc.), curve, kind, and the DKG / accept tx digests for audit.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/dwallets/:id",
    async ({ request, params }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const dw = await getDwalletForUser(user.id, network, params.id);
      if (!dw) throw errors.notFound("dwallet not found", "DWALLET_NOT_FOUND");
      return { dwallet: publicDwallet(dw) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["dwallets"],
        summary: "Get dWallet",
        description:
          "Single dWallet by id. 404 if the dWallet does not belong to the authenticated account.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/dwallets/:id/onchain-state",
    async ({ request, params, query }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const dw = await getDwalletForUser(user.id, network, params.id);
      if (!dw) throw errors.notFound("dwallet not found", "DWALLET_NOT_FOUND");
      const status =
        query.status === "active" ? "Active" : "AwaitingKeyHolderSignature";
      const timeoutMs = Math.min(
        Math.max(
          Number.parseInt(query.timeoutMs ?? "60000", 10) || 60_000,
          1_000,
        ),
        600_000,
      );
      const result = await fetchDwalletOnchainState(
        network,
        dw.suiDwalletId,
        status,
        timeoutMs,
      );
      return {
        suiDwalletId: dw.suiDwalletId,
        status,
        publicOutputHex: result.publicOutputHex,
      };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({
        status: t.Union([
          t.Literal("awaiting_user_share"),
          t.Literal("active"),
        ]),
        timeoutMs: t.Optional(t.String()),
      }),
      detail: {
        tags: ["dwallets"],
        summary: "Poll on-chain dWallet state",
        description:
          "Long-polls Sui until the dWallet reaches the requested state and returns the on-chain `publicOutput` as hex. SDKs use this between DKG and accept (status=`awaiting_user_share`) and after accept (status=`active`) to obtain the public output the local crypto needs. `timeoutMs` clamps to [1s, 600s]; default 60s. The operator proxies Sui gRPC because the Rust SDK can't reach Sui state efficiently.",
        security: [{ bearer: [] }],
      },
    },
  );
