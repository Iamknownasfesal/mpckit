/// Authentication for mpckitcore shared dWallets.
///
/// Each `Credential` is a `(scheme, pubkey-or-address)` pair. Authorisation
/// is a signature over a per-operation challenge, never `ctx.sender()`,
/// so the gas-paying tx sender (the ika-api hot wallet, or any sponsor)
/// is decoupled from the authenticating identity.
///
/// Shared dWallets are M-of-N. Every state-changing op on a shared
/// dWallet takes a `vector<Credential>` and requires at least
/// `threshold` distinct valid signers. M=1 is a vector of length one.
///
/// Schemes (kept in lockstep with recovery so off-chain SDKs share an
/// auth surface):
///   0 = Ed25519        (32-byte pubkey, raw `signPersonalMessage` sig)
///   1 = Secp256k1      (33-byte compressed pubkey, raw `signPersonalMessage` sig)
///   2 = Secp256r1      (33-byte compressed pubkey, raw `signPersonalMessage` sig)
///   3 = WebAuthn       (33-byte compressed secp256r1 passkey pubkey,
///                       full WebAuthn assertion verified by `assertion`)
///   4 = SenderAddress  (32-byte Sui address; auth is `ctx.sender() == addr`,
///                       which is exactly how Sui validators verify zkLogin /
///                       MultiSig / Passkey-as-sender signatures on the way in.
///                       These credentials are *approver-only*: useful for
///                       gating ops that don't require a Move-level signature
///                       payload, e.g. roster changes; not useful for the
///                       coordinator-side cryptographic primitives.)
///
/// Credential id (for dedup + lookup) =
///   `[scheme_byte, ...pubkey_or_address_bytes]`. Different schemes never
///   collide because the byte tag is always prefixed.
module mpckitcore::auth;

use mpckitcore::assertion::{Self, WebAuthnAssertion};
use std::bcs;
use sui::{ecdsa_k1, ecdsa_r1, ed25519, hash, vec_set::{Self, VecSet}};

const SCHEME_ED25519: u8 = 0;
const SCHEME_SECP256K1: u8 = 1;
const SCHEME_SECP256R1: u8 = 2;
const SCHEME_WEBAUTHN: u8 = 3;
const SCHEME_SENDER_ADDRESS: u8 = 4;

/// `hash` arg for ecdsa_{k1,r1}::*_verify; 0 means SHA-256.
const SHA256_HASH: u8 = 0;

const EUnknownCredential: u64 = 1;
const EBadSignature: u64 = 2;
const EBadChallengeLength: u64 = 3;
const EBadPubkeyLength: u64 = 4;
const ENotEnoughSignatures: u64 = 5;
const EDuplicateSigner: u64 = 6;
/// Caller passed a SenderAddress credential whose embedded address doesn't
/// match `ctx.sender()`. Verifying explicitly is cheap and closes the
/// loophole where a hand-built credential with a forged address slips through.
const EWrongSender: u64 = 7;

// ===== Credential =====

public enum Credential has drop {
    Ed25519 { signature: vector<u8>, public_key: vector<u8> },
    Secp256k1 { signature: vector<u8>, public_key: vector<u8> },
    Secp256r1 { signature: vector<u8>, public_key: vector<u8> },
    WebAuthn(WebAuthnAssertion),
    SenderAddress(address),
}

public fun ed25519_credential(signature: vector<u8>, public_key: vector<u8>): Credential {
    Credential::Ed25519 { signature, public_key }
}

public fun secp256k1_credential(signature: vector<u8>, public_key: vector<u8>): Credential {
    Credential::Secp256k1 { signature, public_key }
}

public fun secp256r1_credential(signature: vector<u8>, public_key: vector<u8>): Credential {
    Credential::Secp256r1 { signature, public_key }
}

public fun webauthn_credential(a: WebAuthnAssertion): Credential {
    Credential::WebAuthn(a)
}

/// Wrap `ctx.sender()` as a credential. Use this for identities whose
/// authentication is delegated to Sui's tx-signature pipeline (zkLogin,
/// MultiSig, Passkey-as-sender). Validators have already verified the
/// signature on the way in by the time Move runs; we only need to confirm
/// the sender is a registered credential.
public fun sender_credential(ctx: &TxContext): Credential {
    Credential::SenderAddress(ctx.sender())
}

/// True when the credential is the approver-only variant. Callers gating
/// ops that need a coordinator-side cryptographic primitive (DKG signer
/// pubkey, sign centralized message) should reject this variant.
public fun is_approver_only(cred: &Credential): bool {
    match (cred) {
        Credential::SenderAddress(_) => true,
        _ => false,
    }
}

/// Verify one credential against `credentials` for `expected_challenge`.
/// Returns the canonical credential id of the signer.
public(package) fun verify_one(
    cred: Credential,
    credentials: &VecSet<vector<u8>>,
    expected_challenge: &vector<u8>,
    ctx: &TxContext,
): vector<u8> {
    assert!(expected_challenge.length() == 32, EBadChallengeLength);
    match (cred) {
        Credential::Ed25519 { signature, public_key } => {
            assert!(public_key.length() == 32, EBadPubkeyLength);
            let id = credential_id(SCHEME_ED25519, &public_key);
            assert!(credentials.contains(&id), EUnknownCredential);
            let digest = personal_message_digest(expected_challenge);
            let ok = ed25519::ed25519_verify(&signature, &public_key, &digest);
            assert!(ok, EBadSignature);
            id
        },
        Credential::Secp256k1 { signature, public_key } => {
            assert!(public_key.length() == 33, EBadPubkeyLength);
            let id = credential_id(SCHEME_SECP256K1, &public_key);
            assert!(credentials.contains(&id), EUnknownCredential);
            let digest = personal_message_digest(expected_challenge);
            let ok = ecdsa_k1::secp256k1_verify(&signature, &public_key, &digest, SHA256_HASH);
            assert!(ok, EBadSignature);
            id
        },
        Credential::Secp256r1 { signature, public_key } => {
            assert!(public_key.length() == 33, EBadPubkeyLength);
            let id = credential_id(SCHEME_SECP256R1, &public_key);
            assert!(credentials.contains(&id), EUnknownCredential);
            let digest = personal_message_digest(expected_challenge);
            let ok = ecdsa_r1::secp256r1_verify(&signature, &public_key, &digest, SHA256_HASH);
            assert!(ok, EBadSignature);
            id
        },
        Credential::WebAuthn(a) => {
            let pk = *assertion::public_key(&a);
            let id = credential_id(SCHEME_WEBAUTHN, &pk);
            assert!(credentials.contains(&id), EUnknownCredential);
            assertion::verify_signature(&a, expected_challenge);
            id
        },
        Credential::SenderAddress(addr) => {
            assert!(addr == ctx.sender(), EWrongSender);
            let addr_bytes = addr.to_bytes();
            let id = credential_id(SCHEME_SENDER_ADDRESS, &addr_bytes);
            assert!(credentials.contains(&id), EUnknownCredential);
            id
        },
    }
}

/// Verify M-of-N. Each credential is checked individually; duplicates are
/// rejected so a single key signing twice doesn't satisfy a threshold of two.
public(package) fun verify_threshold(
    mut creds: vector<Credential>,
    credentials: &VecSet<vector<u8>>,
    expected_challenge: &vector<u8>,
    threshold: u64,
    ctx: &TxContext,
) {
    assert!(creds.length() >= threshold, ENotEnoughSignatures);
    let mut seen = vec_set::empty<vector<u8>>();
    while (!creds.is_empty()) {
        let cred = creds.pop_back();
        let id = verify_one(cred, credentials, expected_challenge, ctx);
        assert!(!seen.contains(&id), EDuplicateSigner);
        seen.insert(id);
    };
    creds.destroy_empty();
}

/// Recreate the 32-byte digest a Sui wallet's `signPersonalMessage`
/// produces:
///   `blake2b256([3, 0, 0] || bcs(message))`
fun personal_message_digest(challenge: &vector<u8>): vector<u8> {
    let intent = vector[3u8, 0u8, 0u8];
    let payload = bcs::to_bytes(challenge);
    let mut signed = intent;
    signed.append(payload);
    hash::blake2b256(&signed)
}

fun credential_id(scheme: u8, public_key: &vector<u8>): vector<u8> {
    let mut id = vector::empty<u8>();
    id.push_back(scheme);
    id.append(*public_key);
    id
}

// ===== NewCredential =====

public enum NewCredential has copy, drop, store {
    Ed25519(vector<u8>),
    Secp256k1(vector<u8>),
    Secp256r1(vector<u8>),
    WebAuthn(vector<u8>),
    SenderAddress(address),
}

public fun new_ed25519_credential(public_key: vector<u8>): NewCredential {
    NewCredential::Ed25519(public_key)
}

public fun new_secp256k1_credential(public_key: vector<u8>): NewCredential {
    NewCredential::Secp256k1(public_key)
}

public fun new_secp256r1_credential(public_key: vector<u8>): NewCredential {
    NewCredential::Secp256r1(public_key)
}

public fun new_webauthn_credential(public_key: vector<u8>): NewCredential {
    NewCredential::WebAuthn(public_key)
}

public fun new_sender_credential(addr: address): NewCredential {
    NewCredential::SenderAddress(addr)
}

public fun is_approver_only_new(c: &NewCredential): bool {
    match (c) {
        NewCredential::SenderAddress(_) => true,
        _ => false,
    }
}

public(package) fun new_credential_id_bytes(c: &NewCredential): vector<u8> {
    match (c) {
        NewCredential::Ed25519(pk) => credential_id(SCHEME_ED25519, pk),
        NewCredential::Secp256k1(pk) => credential_id(SCHEME_SECP256K1, pk),
        NewCredential::Secp256r1(pk) => credential_id(SCHEME_SECP256R1, pk),
        NewCredential::WebAuthn(pk) => credential_id(SCHEME_WEBAUTHN, pk),
        NewCredential::SenderAddress(addr) => credential_id(
            SCHEME_SENDER_ADDRESS,
            &(*addr).to_bytes(),
        ),
    }
}

public(package) fun is_already_registered(
    c: &NewCredential,
    credentials: &VecSet<vector<u8>>,
): bool {
    credentials.contains(&new_credential_id_bytes(c))
}

public(package) fun insert_credential(c: NewCredential, credentials: &mut VecSet<vector<u8>>) {
    credentials.insert(new_credential_id_bytes(&c));
}

public(package) fun remove_credential(
    credential_id_bytes: vector<u8>,
    credentials: &mut VecSet<vector<u8>>,
) {
    credentials.remove(&credential_id_bytes);
}

public(package) fun assert_pubkey_length(c: &NewCredential) {
    match (c) {
        NewCredential::Ed25519(pk) => assert!(pk.length() == 32, EBadPubkeyLength),
        NewCredential::Secp256k1(pk) => assert!(pk.length() == 33, EBadPubkeyLength),
        NewCredential::Secp256r1(pk) => assert!(pk.length() == 33, EBadPubkeyLength),
        NewCredential::WebAuthn(pk) => assert!(pk.length() == 33, EBadPubkeyLength),
        NewCredential::SenderAddress(_) => (),
    }
}
