import { errors } from "@/shared/errors";
import type { ExecutedTx } from "@/shared/sui/hot-wallet";
/**
 * Helpers for extracting created object ids + parsed events from an
 * `ExecutedTx`. Routes / workers use these instead of touching the
 * raw `effects` shape directly so the parsing logic stays in one
 * place and stays testable.
 */
import type { SuiClientTypes } from "@mysten/sui/client";

/**
 * Object ids of objects this PTB created, optionally filtered by a
 * substring of the object's Move type tag.
 *
 * Common patterns:
 *   `findCreatedByType(tx, "::account::Account")`
 *   `findCreatedByType(tx, "::coordinator_inner::DWalletCap")`
 *   `findCreatedByType(tx, "::coordinator_inner::UnverifiedPresignCap")`
 */
export function findCreatedByType(
  tx: ExecutedTx,
  typeContains: string,
): string[] {
  const created = tx.effects.changedObjects.filter(
    (o) => o.idOperation === "Created",
  );
  return created
    .filter((o) => {
      const t = tx.objectTypes[o.objectId];
      return typeof t === "string" && t.includes(typeContains);
    })
    .map((o) => o.objectId);
}

export function findFirstCreatedByType(
  tx: ExecutedTx,
  typeContains: string,
): string {
  const ids = findCreatedByType(tx, typeContains);
  if (ids.length === 0) {
    throw errors.internal(
      `no created object matched type containing "${typeContains}"`,
      "OBJECT_NOT_IN_EFFECTS",
    );
  }
  return ids[0]!;
}

/**
 * All created objects whose owner is the given address. Useful for
 * presign batches where we transfer N caps to the operator's wallet
 * in a single PTB.
 */
export function findCreatedOwnedBy(
  tx: ExecutedTx,
  ownerAddress: string,
  typeContains?: string,
): string[] {
  return tx.effects.changedObjects
    .filter((o) => o.idOperation === "Created")
    .filter((o) => isOwnedBy(o.outputOwner, ownerAddress))
    .filter(
      (o) =>
        typeContains === undefined ||
        (tx.objectTypes[o.objectId]?.includes(typeContains) ?? false),
    )
    .map((o) => o.objectId);
}

function isOwnedBy(
  owner: SuiClientTypes.ObjectOwner | null,
  address: string,
): boolean {
  if (!owner) return false;
  // gRPC ObjectOwner is a discriminated union with shape
  //   { $kind: "AddressOwner", AddressOwner: "0x…" }
  //   { $kind: "ObjectOwner",  ObjectOwner:  "0x…" }
  //   { $kind: "Shared",       Shared: { initial_shared_version: number } }
  //   { $kind: "Immutable" }
  // We only treat AddressOwner as a user-controlled match.
  const tagged = owner as { $kind?: string; AddressOwner?: string };
  return tagged.$kind === "AddressOwner" && tagged.AddressOwner === address;
}

/** Events whose Move type tag contains the given substring. */
export function findEvents(
  tx: ExecutedTx,
  typeContains: string,
): SuiClientTypes.Event[] {
  return tx.events.filter((e) => e.eventType.includes(typeContains));
}
