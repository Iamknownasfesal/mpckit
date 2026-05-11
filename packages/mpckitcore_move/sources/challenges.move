/// Operation-bound challenge derivation for shared-dWallet ops.
///
/// Only shared dWallets carry a Move-level roster. Zero-trust and
/// imported-key dWallets are gated cryptographically by the coordinator
/// (centralized message + share encryption) and don't need challenges.
///
/// Challenge =
///   `sha2_256(domain_tag || stored_uid || nonce_le || payload_digest)`
/// where:
///   - `domain_tag` is operation-specific so an `add_credential`
///     assertion can never be replayed against `request_sign`.
///   - `stored_uid` is the 32-byte address of the on-chain
///     `StoredSharedDWallet` wrapper. Binding to the live wrapper UID
///     means a signature is non-transferable across dWallets even if
///     two share a credential pubkey.
///   - `nonce_le` is the per-shared-dWallet monotonic counter, LE u64.
///     Bumped on every state-changing op; prevents replay.
///   - `payload_digest` is a sha2_256 of all op-specific arguments so
///     an attacker cannot shift bytes between fields.
#[allow(implicit_const_copy)]
module mpckitcore::challenges;

use std::hash;

const TAG_ADD_CREDENTIAL: vector<u8> = b"mpckitcore::shared::add_credential";
const TAG_REMOVE_CREDENTIAL: vector<u8> = b"mpckitcore::shared::remove_credential";
const TAG_SET_THRESHOLD: vector<u8> = b"mpckitcore::shared::set_threshold";

const TAG_REQUEST_SIGN: vector<u8> = b"mpckitcore::shared::request_sign";
const TAG_REQUEST_FUTURE_SIGN: vector<u8> = b"mpckitcore::shared::request_future_sign";
const TAG_COMPLETE_FUTURE_SIGN: vector<u8> = b"mpckitcore::shared::complete_future_sign";

// ===== Public derivers =====

public(package) fun add_credential(
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    new_credential_id: &vector<u8>,
): vector<u8> {
    derive(&TAG_ADD_CREDENTIAL, stored_uid_bytes, nonce, new_credential_id)
}

public(package) fun remove_credential(
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    target_credential_id: &vector<u8>,
): vector<u8> {
    derive(&TAG_REMOVE_CREDENTIAL, stored_uid_bytes, nonce, target_credential_id)
}

public(package) fun set_threshold(
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    new_threshold: u64,
): vector<u8> {
    let payload = u64_to_le_bytes(new_threshold);
    derive(&TAG_SET_THRESHOLD, stored_uid_bytes, nonce, &payload)
}

public(package) fun request_sign(
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    payload_digest: &vector<u8>,
): vector<u8> {
    derive(&TAG_REQUEST_SIGN, stored_uid_bytes, nonce, payload_digest)
}

public(package) fun request_future_sign(
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    payload_digest: &vector<u8>,
): vector<u8> {
    derive(&TAG_REQUEST_FUTURE_SIGN, stored_uid_bytes, nonce, payload_digest)
}

public(package) fun complete_future_sign(
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    payload_digest: &vector<u8>,
): vector<u8> {
    derive(&TAG_COMPLETE_FUTURE_SIGN, stored_uid_bytes, nonce, payload_digest)
}

// ===== Internals =====

fun derive(
    tag: &vector<u8>,
    stored_uid_bytes: &vector<u8>,
    nonce: u64,
    payload_digest: &vector<u8>,
): vector<u8> {
    let mut buf = vector::empty<u8>();
    buf.append(*tag);
    buf.append(*stored_uid_bytes);
    buf.append(u64_to_le_bytes(nonce));
    buf.append(*payload_digest);
    hash::sha2_256(buf)
}

public(package) fun u64_to_le_bytes(v: u64): vector<u8> {
    let mut bytes = vector::empty<u8>();
    let mut i: u64 = 0;
    while (i < 8) {
        let shift = ((i as u8)) * 8;
        bytes.push_back(((v >> shift) & 0xff) as u8);
        i = i + 1;
    };
    bytes
}
