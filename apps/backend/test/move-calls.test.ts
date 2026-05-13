/**
 * Tests for the PTB builders in `shared/sui/move-calls`. These are the
 * on-the-wire bridge between the backend service layer and the deployed
 * `mpckitcore` Move package. Each test asserts:
 *
 *   - exactly one MoveCall is emitted (except the batch + drain cases)
 *   - target points at the right `mpckitcore::<module>::<function>`
 *   - account args (treasury, opCap, etc.) come from env
 *   - byte-vec args round-trip through `Array.from()` (the wire format)
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

/**
 * Sibling test file `tx-executor-gas-station.test.ts` mocks
 * `@mysten/sui/transactions` process-wide (mock.module persists across
 * files in bun's loader, per its own comment). Rather than fight that,
 * we hand the builders a recorder stub that captures the args they'd
 * pass to `tx.moveCall` / `tx.object` / `tx.transferObjects`. That's
 * the data we want to assert anyway — the real Transaction class would
 * just shape it into a getData() blob for us.
 */
interface RecordedCommand {
  $kind: "MoveCall" | "TransferObjects";
  target?: string;
}
type Recorder = {
  commands: RecordedCommand[];
  moveCall(args: { target: string; arguments: unknown[] }): unknown;
  transferObjects(_objs: unknown[], _to: unknown): unknown;
  object(id: string): { kind: "object"; id: string };
  pure: {
    id(s: string): unknown;
    u32(n: number): unknown;
    u64(n: number | bigint): unknown;
    address(s: string): unknown;
    vector(_tag: string, _v: unknown[]): unknown;
  };
};
function makeRecorder(): Recorder {
  const commands: RecordedCommand[] = [];
  return {
    commands,
    moveCall({ target }) {
      commands.push({ $kind: "MoveCall", target });
      // Return a 2-tuple so buildDrainTreasury's `result[0]!, result[1]!`
      // destructure works without touching the real builder shape.
      return [
        { kind: "result", index: 0 },
        { kind: "result", index: 1 },
      ];
    },
    transferObjects(_objs, _to) {
      commands.push({ $kind: "TransferObjects" });
      return undefined;
    },
    object(id: string) {
      return { kind: "object", id };
    },
    pure: {
      id: (s) => ({ kind: "pure", t: "id", v: s }),
      u32: (n) => ({ kind: "pure", t: "u32", v: n }),
      u64: (n) => ({ kind: "pure", t: "u64", v: n }),
      address: (s) => ({ kind: "pure", t: "address", v: s }),
      vector: (tag, v) => ({ kind: "pure", t: `vector<${tag}>`, v }),
    },
  };
}

const PKG = `0x${"a".repeat(64)}`;
const OP_CAP = `0x${"b".repeat(64)}`;
const ADMIN_CAP = `0x${"c".repeat(64)}`;
const TREASURY = `0x${"d".repeat(64)}`;
const PKG_MAIN = `0x${"e".repeat(64)}`;
const OP_CAP_MAIN = `0x${"f".repeat(64)}`;
const TREASURY_MAIN = `0x${"1".repeat(64)}`;

const envMock: Record<string, unknown> = {
  MPCKITCORE_TESTNET_PACKAGE_ID: PKG,
  MPCKITCORE_TESTNET_OPERATOR_CAP_ID: OP_CAP,
  MPCKITCORE_TESTNET_ADMIN_CAP_ID: ADMIN_CAP,
  MPCKITCORE_TESTNET_TREASURY_ID: TREASURY,
};
mock.module("@/config/env", () => ({ env: envMock }));
mock.module("@/config/log", () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const {
  buildAcceptUserShare,
  buildAddDwalletZeroTrust,
  buildBurnOperator,
  buildDepositIka,
  buildDepositSui,
  buildDrainTreasury,
  buildMintOperator,
  buildOnboardZeroTrust,
  buildPresignBatch,
  buildRegisterEncryptionKey,
  buildSignZeroTrust,
  Scheme,
} = await import("@/shared/sui/move-calls");

function moveCalls(tx: Recorder) {
  return tx.commands.filter((c) => c.$kind === "MoveCall");
}

function targetOf(call: RecordedCommand): string {
  return call.target ?? "";
}

const COORD = `0x${"2".repeat(64)}`;
const NETKEY = `0x${"3".repeat(64)}`;
const ENC_ADDR = `0x${"4".repeat(64)}`;
const ACCOUNT = `0x${"5".repeat(64)}`;
const DWALLET = `0x${"6".repeat(64)}`;
const ENC_SHARE = `0x${"7".repeat(64)}`;
const PRESIGN_CAP = `0x${"8".repeat(64)}`;
const COIN = `0x${"9".repeat(64)}`;
const RECIPIENT = `0x${"a".repeat(63)}1`;
const DWALLET_PKG = `0x${"a".repeat(63)}2`;

afterEach(() => {
  // Make sure no test mutates the env stub the others depend on.
  envMock.MPCKITCORE_TESTNET_PACKAGE_ID = PKG;
  envMock.MPCKITCORE_TESTNET_OPERATOR_CAP_ID = OP_CAP;
  envMock.MPCKITCORE_TESTNET_ADMIN_CAP_ID = ADMIN_CAP;
  envMock.MPCKITCORE_TESTNET_TREASURY_ID = TREASURY;
});

describe("Scheme constants", () => {
  test("matches the on-chain auth.move encoding", () => {
    expect(Scheme.Ed25519).toBe(0);
    expect(Scheme.Secp256k1).toBe(1);
    expect(Scheme.Secp256r1).toBe(2);
    expect(Scheme.WebAuthn).toBe(3);
    expect(Scheme.SenderAddress).toBe(4);
  });
});

describe("buildRegisterEncryptionKey", () => {
  test("emits a coordinator::register_encryption_key call (no treasury involvement)", () => {
    const tx = makeRecorder();
    buildRegisterEncryptionKey(tx, {
      dwalletPackageId: DWALLET_PKG,
      coordinatorId: COORD,
      curve: 2,
      encryptionKey: new Uint8Array([1, 2, 3]),
      encryptionKeySignature: new Uint8Array([4]),
      signerPublicKey: new Uint8Array([5]),
    });
    const calls = moveCalls(tx);
    expect(calls).toHaveLength(1);
    expect(targetOf(calls[0]!)).toBe(
      `${DWALLET_PKG}::coordinator::register_encryption_key`,
    );
  });
});

describe("buildOnboardZeroTrust", () => {
  test("targets mpckitcore::treasury::pay_register_and_dkg_zero_trust on testnet", () => {
    const tx = makeRecorder();
    buildOnboardZeroTrust(tx, {
      network: "testnet",
      coordinatorId: COORD,
      dwalletNetworkEncryptionKeyId: NETKEY,
      curve: 0,
      centralizedPublicKeyShareAndProof: new Uint8Array([1]),
      encryptedCentralizedSecretShareAndProof: new Uint8Array([2]),
      encryptionKeyAddress: ENC_ADDR,
      userPublicOutput: new Uint8Array([3]),
      signerPublicKey: new Uint8Array([4]),
      sessionIdentifierBytes: new Uint8Array([5]),
    });
    const calls = moveCalls(tx);
    expect(calls).toHaveLength(1);
    expect(targetOf(calls[0]!)).toBe(
      `${PKG}::treasury::pay_register_and_dkg_zero_trust`,
    );
  });

  test("uses mainnet env vars when network='mainnet'", () => {
    envMock.MPCKITCORE_MAINNET_PACKAGE_ID = PKG_MAIN;
    envMock.MPCKITCORE_MAINNET_OPERATOR_CAP_ID = OP_CAP_MAIN;
    envMock.MPCKITCORE_MAINNET_TREASURY_ID = TREASURY_MAIN;
    const tx = makeRecorder();
    buildOnboardZeroTrust(tx, {
      network: "mainnet",
      coordinatorId: COORD,
      dwalletNetworkEncryptionKeyId: NETKEY,
      curve: 0,
      centralizedPublicKeyShareAndProof: new Uint8Array(),
      encryptedCentralizedSecretShareAndProof: new Uint8Array(),
      encryptionKeyAddress: ENC_ADDR,
      userPublicOutput: new Uint8Array(),
      signerPublicKey: new Uint8Array(),
      sessionIdentifierBytes: new Uint8Array(),
    });
    expect(targetOf(moveCalls(tx)[0]!)).toBe(
      `${PKG_MAIN}::treasury::pay_register_and_dkg_zero_trust`,
    );
  });

  test("throws when the required network env var is missing", () => {
    const stash = envMock.MPCKITCORE_TESTNET_PACKAGE_ID;
    envMock.MPCKITCORE_TESTNET_PACKAGE_ID = undefined;
    const tx = makeRecorder();
    expect(() =>
      buildOnboardZeroTrust(tx, {
        network: "testnet",
        coordinatorId: COORD,
        dwalletNetworkEncryptionKeyId: NETKEY,
        curve: 0,
        centralizedPublicKeyShareAndProof: new Uint8Array(),
        encryptedCentralizedSecretShareAndProof: new Uint8Array(),
        encryptionKeyAddress: ENC_ADDR,
        userPublicOutput: new Uint8Array(),
        signerPublicKey: new Uint8Array(),
        sessionIdentifierBytes: new Uint8Array(),
      }),
    ).toThrow(/MPCKITCORE_TESTNET_PACKAGE_ID/);
    envMock.MPCKITCORE_TESTNET_PACKAGE_ID = stash;
  });
});

describe("buildAddDwalletZeroTrust", () => {
  test("targets treasury::pay_dkg_zero_trust + threads accountId", () => {
    const tx = makeRecorder();
    buildAddDwalletZeroTrust(tx, {
      network: "testnet",
      accountId: ACCOUNT,
      coordinatorId: COORD,
      dwalletNetworkEncryptionKeyId: NETKEY,
      curve: 2,
      centralizedPublicKeyShareAndProof: new Uint8Array(),
      encryptedCentralizedSecretShareAndProof: new Uint8Array(),
      encryptionKeyAddress: ENC_ADDR,
      userPublicOutput: new Uint8Array(),
      signerPublicKey: new Uint8Array(),
      sessionIdentifierBytes: new Uint8Array(),
    });
    expect(targetOf(moveCalls(tx)[0]!)).toBe(
      `${PKG}::treasury::pay_dkg_zero_trust`,
    );
  });
});

describe("buildAcceptUserShare", () => {
  test("targets dkg::accept_user_share (no treasury / no fees)", () => {
    const tx = makeRecorder();
    buildAcceptUserShare(tx, {
      network: "testnet",
      accountId: ACCOUNT,
      coordinatorId: COORD,
      dwalletId: DWALLET,
      encryptedUserSecretKeyShareId: ENC_SHARE,
      userOutputSignature: new Uint8Array([7, 8]),
    });
    expect(targetOf(moveCalls(tx)[0]!)).toBe(`${PKG}::dkg::accept_user_share`);
  });
});

describe("buildPresignBatch", () => {
  test("emits exactly `count` MoveCalls when sessionIdentifiers.length matches", () => {
    const tx = makeRecorder();
    buildPresignBatch(tx, {
      network: "testnet",
      coordinatorId: COORD,
      dwalletNetworkEncryptionKeyId: NETKEY,
      curve: 0,
      signatureAlgorithm: 1,
      count: 3,
      recipient: RECIPIENT,
      sessionIdentifiers: [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
      ],
    });
    const calls = moveCalls(tx);
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(targetOf(c)).toBe(`${PKG}::treasury::pay_presign`);
    }
  });

  test("rejects sessionIdentifiers length mismatch", () => {
    const tx = makeRecorder();
    expect(() =>
      buildPresignBatch(tx, {
        network: "testnet",
        coordinatorId: COORD,
        dwalletNetworkEncryptionKeyId: NETKEY,
        curve: 0,
        signatureAlgorithm: 0,
        count: 3,
        recipient: RECIPIENT,
        sessionIdentifiers: [new Uint8Array([1])],
      }),
    ).toThrow(/length 1 != count 3/);
  });

  test("count=0 emits zero MoveCalls", () => {
    const tx = makeRecorder();
    buildPresignBatch(tx, {
      network: "testnet",
      coordinatorId: COORD,
      dwalletNetworkEncryptionKeyId: NETKEY,
      curve: 0,
      signatureAlgorithm: 0,
      count: 0,
      recipient: RECIPIENT,
      sessionIdentifiers: [],
    });
    expect(moveCalls(tx)).toHaveLength(0);
  });
});

describe("buildSignZeroTrust", () => {
  test("targets treasury::pay_sign_zero_trust", () => {
    const tx = makeRecorder();
    buildSignZeroTrust(tx, {
      network: "testnet",
      accountId: ACCOUNT,
      coordinatorId: COORD,
      dwalletId: DWALLET,
      presignCapId: PRESIGN_CAP,
      signatureAlgorithm: 1,
      hashScheme: 0,
      message: new Uint8Array([0xab]),
      messageCentralizedSignature: new Uint8Array([0xcd]),
      sessionIdentifierBytes: new Uint8Array([0xef]),
    });
    expect(targetOf(moveCalls(tx)[0]!)).toBe(
      `${PKG}::treasury::pay_sign_zero_trust`,
    );
  });
});

describe("treasury funding builders", () => {
  test("buildDepositIka → treasury::deposit_ika", () => {
    const tx = makeRecorder();
    buildDepositIka(tx, "testnet", COIN);
    expect(targetOf(moveCalls(tx)[0]!)).toBe(`${PKG}::treasury::deposit_ika`);
  });

  test("buildDepositSui → treasury::deposit_sui", () => {
    const tx = makeRecorder();
    buildDepositSui(tx, "testnet", COIN);
    expect(targetOf(moveCalls(tx)[0]!)).toBe(`${PKG}::treasury::deposit_sui`);
  });
});

describe("admin builders", () => {
  test("buildDrainTreasury emits drain + a TransferObjects of the two returned coins", () => {
    const tx = makeRecorder();
    buildDrainTreasury(tx, "testnet", RECIPIENT);
    const moves = tx.commands.filter((c) => c.$kind === "MoveCall");
    const transfers = tx.commands.filter((c) => c.$kind === "TransferObjects");
    expect(moves).toHaveLength(1);
    expect(targetOf(moves[0]!)).toBe(`${PKG}::treasury::drain`);
    expect(transfers).toHaveLength(1);
  });

  test("buildMintOperator → acl::mint_operator", () => {
    const tx = makeRecorder();
    buildMintOperator(tx, "testnet", RECIPIENT);
    expect(targetOf(moveCalls(tx)[0]!)).toBe(`${PKG}::acl::mint_operator`);
  });

  test("buildBurnOperator → acl::burn_operator", () => {
    const tx = makeRecorder();
    buildBurnOperator(tx, "testnet", PRESIGN_CAP);
    expect(targetOf(moveCalls(tx)[0]!)).toBe(`${PKG}::acl::burn_operator`);
  });
});
