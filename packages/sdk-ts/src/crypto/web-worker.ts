/**
 * `WebWorkerCryptoEngine` proxies every engine method over postMessage
 * to a worker that runs the inline implementation. Pass an already-
 * constructed `Worker` (the consumer owns the URL resolution + module
 * type, since bundlers all do this differently).
 *
 * Consumer side, typical shape:
 *
 *   import { MpcKit, createWebWorkerCryptoEngine } from "@mpckit/sdk";
 *   const worker = new Worker(
 *     new URL("@mpckit/sdk/worker-impl", import.meta.url),
 *     { type: "module" }
 *   );
 *   const api = new MpcKit({
 *     ...config,
 *     crypto: createWebWorkerCryptoEngine(worker),
 *   });
 */
import type { Curve, Hash, SignatureAlgorithm } from "../constants";
import { MpcKitError } from "../errors";
import type { CryptoEngine, DKGOutput, KeySession } from "./engine";
import type { RpcRequest, RpcResponse } from "./rpc";

interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  addEventListener(type: "error", listener: (ev: ErrorEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (ev: MessageEvent) => void,
  ): void;
  terminate?: () => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export class WebWorkerCryptoEngine implements CryptoEngine {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly worker: WorkerLike) {
    this.worker.addEventListener("message", (e) => this.onMessage(e));
    this.worker.addEventListener("error", (e) => this.onError(e));
  }

  openSession(seed: Uint8Array, curve: Curve): Promise<KeySession> {
    return this.call<KeySession>("openSession", { seed, curve });
  }
  closeSession(sessionId: string): Promise<void> {
    return this.call<void>("closeSession", { sessionId });
  }
  signEncryptionKey(sessionId: string): Promise<{ signatureHex: string }> {
    return this.call<{ signatureHex: string }>("signEncryptionKey", {
      sessionId,
    });
  }
  signUserOutput(
    sessionId: string,
    args: { dwalletPublicOutputHex: string; userPublicOutputHex: string },
  ): Promise<{ signatureHex: string }> {
    return this.call<{ signatureHex: string }>("signUserOutput", {
      sessionId,
      ...args,
    });
  }
  prepareDKG(
    sessionId: string,
    args: {
      sessionIdentifierHex: string;
      protocolPublicParametersHex: string;
      networkEncryptionKeyId: string;
      senderAddress: string;
    },
  ): Promise<DKGOutput> {
    return this.call<DKGOutput>("prepareDKG", { sessionId, ...args });
  }
  signCentralizedMessage(
    sessionId: string,
    args: {
      signatureAlgorithm: SignatureAlgorithm;
      hash: Hash;
      protocolPublicParametersHex: string;
      userPublicOutputHex: string;
      userSecretKeyShareHex: string;
      presignBytesHex: string;
      messageHex: string;
    },
  ): Promise<{ signatureHex: string }> {
    return this.call<{ signatureHex: string }>("signCentralizedMessage", {
      sessionId,
      ...args,
    });
  }

  /** Drop the worker and reject any in-flight calls. */
  terminate(): void {
    for (const [, p] of this.pending) {
      p.reject(
        new MpcKitError("worker terminated", 0, "WORKER_TERMINATED", null),
      );
    }
    this.pending.clear();
    this.worker.terminate?.();
  }

  private call<T>(method: RpcRequest["method"], args: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.worker.postMessage({ id, method, args } as RpcRequest);
    });
  }

  private onMessage(e: MessageEvent): void {
    const data = e.data as RpcResponse | undefined;
    if (!data || typeof data.id !== "number") return;
    const pending = this.pending.get(data.id);
    if (!pending) return;
    this.pending.delete(data.id);
    if (data.ok) {
      pending.resolve(data.result);
    } else {
      const err = new MpcKitError(
        data.error.message,
        500,
        data.error.name,
        null,
      );
      pending.reject(err);
    }
  }

  private onError(e: ErrorEvent): void {
    const err = new MpcKitError(
      `worker error: ${e.message}`,
      500,
      "WORKER_ERROR",
      e,
    );
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}

export function createWebWorkerCryptoEngine(worker: WorkerLike): CryptoEngine {
  return new WebWorkerCryptoEngine(worker);
}
