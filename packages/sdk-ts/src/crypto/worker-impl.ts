/**
 * Web Worker entrypoint. Bundle this as a module worker and the
 * `WebWorkerCryptoEngine` proxy will route every call through here.
 *
 * Imports `InlineCryptoEngine`, which transitively imports
 * `@ika.xyz/sdk` — that's intentional: the WASM-heavy work is exactly
 * what we want OFF the main thread.
 */
import { InlineCryptoEngine } from "./inline";
import type { RpcRequest, RpcResponse } from "./rpc";

const engine = new InlineCryptoEngine();

declare const self: {
  onmessage: ((e: MessageEvent<RpcRequest>) => void) | null;
  postMessage(message: unknown): void;
};

self.onmessage = async (event: MessageEvent<RpcRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== "number") return;
  try {
    const result = await dispatch(req);
    const ok: RpcResponse = { id: req.id, ok: true, result };
    self.postMessage(ok);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "Error";
    const fail: RpcResponse = {
      id: req.id,
      ok: false,
      error: { name, message },
    };
    self.postMessage(fail);
  }
};

async function dispatch(req: RpcRequest): Promise<unknown> {
  switch (req.method) {
    case "openSession":
      return engine.openSession(req.args.seed, req.args.curve);
    case "closeSession":
      return engine.closeSession(req.args.sessionId);
    case "signEncryptionKey":
      return engine.signEncryptionKey(req.args.sessionId);
    case "signUserOutput":
      return engine.signUserOutput(req.args.sessionId, {
        dwalletPublicOutputHex: req.args.dwalletPublicOutputHex,
        userPublicOutputHex: req.args.userPublicOutputHex,
      });
    case "prepareDKG":
      return engine.prepareDKG(req.args.sessionId, {
        sessionIdentifierHex: req.args.sessionIdentifierHex,
        protocolPublicParametersHex: req.args.protocolPublicParametersHex,
        networkEncryptionKeyId: req.args.networkEncryptionKeyId,
        senderAddress: req.args.senderAddress,
      });
    case "signCentralizedMessage":
      return engine.signCentralizedMessage(req.args.sessionId, {
        signatureAlgorithm: req.args.signatureAlgorithm,
        hash: req.args.hash,
        protocolPublicParametersHex: req.args.protocolPublicParametersHex,
        userPublicOutputHex: req.args.userPublicOutputHex,
        userSecretKeyShareHex: req.args.userSecretKeyShareHex,
        presignBytesHex: req.args.presignBytesHex,
        messageHex: req.args.messageHex,
      });
  }
}
