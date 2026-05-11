/**
 * Wire format for the worker IPC. Both ends speak this; if you change
 * a method signature on the engine, mirror it here so the worker stays
 * round-trip safe.
 */
import type { Curve, Hash, SignatureAlgorithm } from "../constants";

export type RpcRequest =
  | {
      id: number;
      method: "openSession";
      args: { seed: Uint8Array; curve: Curve };
    }
  | { id: number; method: "closeSession"; args: { sessionId: string } }
  | { id: number; method: "signEncryptionKey"; args: { sessionId: string } }
  | {
      id: number;
      method: "signUserOutput";
      args: {
        sessionId: string;
        dwalletPublicOutputHex: string;
        userPublicOutputHex: string;
      };
    }
  | {
      id: number;
      method: "prepareDKG";
      args: {
        sessionId: string;
        sessionIdentifierHex: string;
        protocolPublicParametersHex: string;
        networkEncryptionKeyId: string;
        senderAddress: string;
      };
    }
  | {
      id: number;
      method: "signCentralizedMessage";
      args: {
        sessionId: string;
        signatureAlgorithm: SignatureAlgorithm;
        hash: Hash;
        protocolPublicParametersHex: string;
        userPublicOutputHex: string;
        userSecretKeyShareHex: string;
        presignBytesHex: string;
        messageHex: string;
      };
    };

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string } };
