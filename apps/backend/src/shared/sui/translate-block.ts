/**
 * JSON-RPC -> gRPC shape translation for `SuiTransactionBlockResponse`.
 *
 * Lives in its own file so `tx-executor.ts` stays focused on the
 * gas-station HTTP dance. The gas-pool replies with Mysten's JSON-RPC
 * `SuiTransactionBlockResponse`; we synthesise just enough of the gRPC
 * `ExecutedTx` shape for `shared/sui/effects.ts` to keep working:
 *   - `effects.changedObjects[].{objectId, idOperation, outputOwner}`
 *   - `events[].{eventType, parsedJson}`
 *   - `objectTypes` keyed by object id
 * Fields that no caller reads today are left empty; we widen the
 * translation when a real consumer shows up.
 */
import type { SuiClientTypes } from "@mysten/sui/client";
import type { ExecutedTx } from "@/shared/sui/hot-wallet";

interface JsonRpcStatus {
  status: "success" | "failure";
  error?: string;
}

interface JsonRpcOwner {
  AddressOwner?: string;
  ObjectOwner?: string;
  Shared?: { initial_shared_version: number };
}

export interface JsonRpcObjectChange {
  type:
    | "published"
    | "transferred"
    | "mutated"
    | "deleted"
    | "wrapped"
    | "created";
  objectId?: string;
  objectType?: string;
  owner?: JsonRpcOwner | "Immutable";
}

export interface JsonRpcEvent {
  type: string;
  packageId?: string;
  transactionModule?: string;
  sender?: string;
  parsedJson?: unknown;
  bcs?: string;
}

export interface TxBlockResponse {
  digest: string;
  effects?: { status?: JsonRpcStatus } | null;
  events?: JsonRpcEvent[] | null;
  objectChanges?: JsonRpcObjectChange[] | null;
}

export function translateBlock(block: TxBlockResponse): ExecutedTx {
  const objectTypes: Record<string, string> = {};
  const changedObjects: SuiClientTypes.TransactionEffects["changedObjects"] =
    [];
  for (const c of block.objectChanges ?? []) {
    if (!c.objectId) continue;
    if (c.objectType) objectTypes[c.objectId] = c.objectType;
    const idOperation = mapIdOperation(c.type);
    if (!idOperation) continue;
    changedObjects.push({
      objectId: c.objectId,
      idOperation,
      outputOwner: translateOwner(c.owner),
    } as SuiClientTypes.TransactionEffects["changedObjects"][number]);
  }
  const events: SuiClientTypes.Event[] = (block.events ?? []).map(
    (e) =>
      ({
        eventType: e.type,
        packageId: e.packageId,
        sender: e.sender,
        // gRPC `Event` uses `json` for the parsed payload; JSON-RPC
        // calls it `parsedJson`. Provide `json` since that's what the
        // sign service reads.
        json: e.parsedJson ?? null,
        // gRPC ships `bcs` as raw bytes; JSON-RPC ships base64.
        // `decodeDKGEvent` wraps with `new Uint8Array(ev.bcs)`, so we
        // hand it real bytes here.
        bcs: e.bcs ? new Uint8Array(Buffer.from(e.bcs, "base64")) : undefined,
      }) as unknown as SuiClientTypes.Event,
  );
  return {
    digest: block.digest,
    // Only the fields effects.ts touches are populated. Other consumers
    // would need a richer translation; we add fields when a real caller
    // shows up.
    effects: { changedObjects } as unknown as SuiClientTypes.TransactionEffects,
    events,
    objectTypes,
  };
}

function mapIdOperation(
  t: JsonRpcObjectChange["type"],
): "Created" | "Mutated" | undefined {
  if (t === "created") return "Created";
  if (t === "mutated" || t === "transferred") return "Mutated";
  return undefined; // published / deleted / wrapped — not consumed by callers today
}

function translateOwner(
  o: JsonRpcOwner | "Immutable" | undefined,
): SuiClientTypes.ObjectOwner | null {
  if (!o || o === "Immutable") return null;
  if (o.AddressOwner) {
    return {
      $kind: "AddressOwner",
      AddressOwner: o.AddressOwner,
    } as unknown as SuiClientTypes.ObjectOwner;
  }
  if (o.ObjectOwner) {
    return {
      $kind: "ObjectOwner",
      ObjectOwner: o.ObjectOwner,
    } as unknown as SuiClientTypes.ObjectOwner;
  }
  if (o.Shared) {
    return {
      $kind: "Shared",
      Shared: o.Shared,
    } as unknown as SuiClientTypes.ObjectOwner;
  }
  return null;
}
