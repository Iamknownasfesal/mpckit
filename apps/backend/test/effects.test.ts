/**
 * Tests for the effect-parsing helpers in `shared/sui/effects`. Workers
 * and routes pull object ids + events out of executed PTBs via these
 * helpers, so any drift here corrupts every downstream DB write.
 */
import { describe, expect, test } from "bun:test";
import {
  findCreatedByType,
  findCreatedOwnedBy,
  findEvents,
  findFirstCreatedByType,
} from "@/shared/sui/effects";
import type { ExecutedTx } from "@/shared/sui/hot-wallet";

const ADDR_A =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDR_B =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function tx(overrides: {
  changed?: Array<{
    objectId: string;
    idOperation: "Created" | "Mutated" | "Deleted";
    outputOwner?: unknown;
  }>;
  objectTypes?: Record<string, string>;
  events?: Array<{ eventType: string; [key: string]: unknown }>;
}): ExecutedTx {
  return {
    effects: {
      changedObjects: overrides.changed ?? [],
    },
    objectTypes: overrides.objectTypes ?? {},
    events: (overrides.events ?? []) as ExecutedTx["events"],
  } as unknown as ExecutedTx;
}

describe("findCreatedByType", () => {
  test("returns ids of Created objects matching the type substring", () => {
    const t = tx({
      changed: [
        { objectId: "0x1", idOperation: "Created" },
        { objectId: "0x2", idOperation: "Created" },
        { objectId: "0x3", idOperation: "Mutated" },
      ],
      objectTypes: {
        "0x1": "0xpkg::coordinator_inner::UnverifiedPresignCap",
        "0x2": "0xpkg::account::Account",
        "0x3": "0xpkg::coordinator_inner::UnverifiedPresignCap",
      },
    });
    expect(findCreatedByType(t, "UnverifiedPresignCap")).toEqual(["0x1"]);
    expect(findCreatedByType(t, "account::Account")).toEqual(["0x2"]);
    expect(findCreatedByType(t, "nothing-here")).toEqual([]);
  });

  test("ignores objects without a known type", () => {
    const t = tx({
      changed: [
        { objectId: "0x1", idOperation: "Created" },
        { objectId: "0x2", idOperation: "Created" },
      ],
      objectTypes: { "0x1": "0xpkg::dwallet::DWalletCap" },
    });
    expect(findCreatedByType(t, "DWalletCap")).toEqual(["0x1"]);
  });
});

describe("findFirstCreatedByType", () => {
  test("returns the single match", () => {
    const t = tx({
      changed: [{ objectId: "0xcafe", idOperation: "Created" }],
      objectTypes: { "0xcafe": "0xpkg::dwallet::DWalletCap" },
    });
    expect(findFirstCreatedByType(t, "DWalletCap")).toBe("0xcafe");
  });

  test("returns the first when multiple match", () => {
    const t = tx({
      changed: [
        { objectId: "0x1", idOperation: "Created" },
        { objectId: "0x2", idOperation: "Created" },
      ],
      objectTypes: {
        "0x1": "0xpkg::dwallet::DWalletCap",
        "0x2": "0xpkg::dwallet::DWalletCap",
      },
    });
    expect(findFirstCreatedByType(t, "DWalletCap")).toBe("0x1");
  });

  test("throws AppError-style OBJECT_NOT_IN_EFFECTS when there's no match", () => {
    expect(() => findFirstCreatedByType(tx({}), "PresignCap")).toThrow(
      /PresignCap/,
    );
  });
});

describe("findCreatedOwnedBy", () => {
  test("filters by Created + AddressOwner match", () => {
    const t = tx({
      changed: [
        {
          objectId: "0x1",
          idOperation: "Created",
          outputOwner: { $kind: "AddressOwner", AddressOwner: ADDR_A },
        },
        {
          objectId: "0x2",
          idOperation: "Created",
          outputOwner: { $kind: "AddressOwner", AddressOwner: ADDR_B },
        },
        {
          objectId: "0x3",
          idOperation: "Mutated",
          outputOwner: { $kind: "AddressOwner", AddressOwner: ADDR_A },
        },
      ],
    });
    expect(findCreatedOwnedBy(t, ADDR_A)).toEqual(["0x1"]);
    expect(findCreatedOwnedBy(t, ADDR_B)).toEqual(["0x2"]);
  });

  test("treats Shared / ObjectOwner / Immutable / null owners as non-match", () => {
    const t = tx({
      changed: [
        {
          objectId: "0x1",
          idOperation: "Created",
          outputOwner: {
            $kind: "Shared",
            Shared: { initial_shared_version: 1 },
          },
        },
        {
          objectId: "0x2",
          idOperation: "Created",
          outputOwner: { $kind: "ObjectOwner", ObjectOwner: ADDR_A },
        },
        {
          objectId: "0x3",
          idOperation: "Created",
          outputOwner: { $kind: "Immutable" },
        },
        {
          objectId: "0x4",
          idOperation: "Created",
          outputOwner: null,
        },
      ],
    });
    expect(findCreatedOwnedBy(t, ADDR_A)).toEqual([]);
  });

  test("optional typeContains narrows the result further", () => {
    const t = tx({
      changed: [
        {
          objectId: "0x1",
          idOperation: "Created",
          outputOwner: { $kind: "AddressOwner", AddressOwner: ADDR_A },
        },
        {
          objectId: "0x2",
          idOperation: "Created",
          outputOwner: { $kind: "AddressOwner", AddressOwner: ADDR_A },
        },
      ],
      objectTypes: {
        "0x1": "0xpkg::coordinator_inner::UnverifiedPresignCap",
        "0x2": "0xpkg::account::Account",
      },
    });
    expect(findCreatedOwnedBy(t, ADDR_A, "UnverifiedPresignCap")).toEqual([
      "0x1",
    ]);
    expect(findCreatedOwnedBy(t, ADDR_A, "Account")).toEqual(["0x2"]);
    expect(findCreatedOwnedBy(t, ADDR_A, "nope")).toEqual([]);
  });
});

describe("findEvents", () => {
  test("returns events whose type tag contains the substring", () => {
    const t = tx({
      events: [
        { eventType: "0xpkg::coordinator_inner::PresignCompleted" },
        { eventType: "0xpkg::coordinator_inner::DkgCompleted" },
        { eventType: "0xpkg::account::AccountCreated" },
      ],
    });
    expect(findEvents(t, "PresignCompleted").map((e) => e.eventType)).toEqual([
      "0xpkg::coordinator_inner::PresignCompleted",
    ]);
    expect(findEvents(t, "coordinator_inner").length).toBe(2);
    expect(findEvents(t, "Nothing").length).toBe(0);
  });
});
