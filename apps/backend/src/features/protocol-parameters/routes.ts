import { Elysia, t } from "elysia";
import { getProtocolParameters } from "@/features/protocol-parameters/service";
import { requestNetwork } from "@/http/middleware/auth";

/**
 * Protocol public parameters for a curve. Cached by content hash of
 * the underlying network DKG output, so this endpoint is essentially
 * free after the first call per network reconfiguration.
 *
 * Returns base64-encoded bytes for transport efficiency. Clients pass
 * these into the centralized-party WASM operations.
 */
export const protocolParameterRoutes = new Elysia({ prefix: "/v1" }).get(
  "/protocol-parameters",
  async ({ query, request }) => {
    const network = requestNetwork(request);
    const curve = Number(query.curve);
    const params = await getProtocolParameters(network, curve);
    return {
      curve: params.curve,
      encryptionKeyId: params.encryptionKeyId,
      epoch: params.epoch,
      loadedAt: params.loadedAt,
      // Bytes go over the wire as base64; clients must decode before
      // passing to centralized-party WASM ops.
      bytesBase64: Buffer.from(params.bytes).toString("base64"),
      bytesLength: params.bytes.length,
    };
  },
  {
    query: t.Object({ curve: t.String() }),
    detail: {
      tags: ["network"],
      summary: "Protocol public parameters",
      description:
        "Base64-encoded protocol public parameters for the given curve, sourced from the latest network encryption key. Clients decode and pass these into the centralized-party WASM ops (DKG prep, sign, key import). Cached by content hash, so this endpoint is essentially free after the first call per network reconfiguration. Public — no auth.",
    },
  },
);
