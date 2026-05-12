//! Native crypto wrappers around `dwallet-mpc-centralized-party`.
//!
//! Mirrors the four primitives the TypeScript SDK exposes through its
//! WASM bundle:
//!
//!   - `UserShareEncryptionKeys::from_root_seed_key` (key derivation)
//!   - `prepare_dkg` (centralized DKG ceremony)
//!   - `centralized_sign` (centralized signature for two-phase sign)
//!   - Ed25519 signatures over the encryption-key + dwallet public output
//!
//! Pure native Rust — no WASM. Gated behind the `crypto` feature so
//! the default crate stays HTTP-only and doesn't drag the inkrypto
//! dep graph for callers that only want the typed HTTP client.
//!
//! The numerical layout matches `crates/ika/src/dwallet_commands.rs`'s
//! `derive_encryption_keys` — same domain-separation strings, same
//! curve byte, same hash chain. The on-chain session identifier is
//! computed identically to ika's `register_session_identifier` Move
//! call so the MPC network sees the same session id we do.

use dwallet_mpc_centralized_party::{
    advance_centralized_sign_party, create_dkg_output_by_curve_v2,
    encrypt_secret_key_share_and_prove_v2, generate_cg_keypair_from_seed,
};
use fastcrypto::ed25519::{Ed25519KeyPair, Ed25519PrivateKey};
use fastcrypto::hash::{Blake2b256, HashFunction, Keccak256};
use fastcrypto::traits::{KeyPair, Signer, ToFromBytes};

use crate::constants::{Curve, Hash, SignatureAlgorithm};
use crate::error::{MPCKitError, Result};

const CG_DOMAIN: &[u8] = b"CLASS_GROUPS_DECRYPTION_KEY_V1";
const ED_DOMAIN: &[u8] = b"ED25519_SIGNING_KEY_V1";

/// Per-curve key material derived from a root seed. Holds the
/// Class-groups encryption keypair (used for the DKG transport) and
/// an Ed25519 signing keypair (used to sign the encryption key + the
/// dwallet's public output during the accept step).
///
/// Construct via [`Self::from_root_seed_key`]; never persist the
/// `decryption_key` in plaintext outside the user's local trust
/// boundary.
pub struct UserShareEncryptionKeys {
    /// BCS-encoded `VersionedEncryptionKeyValue::V1`. The shape the
    /// backend's `/v1/encryption-keys` endpoint expects as
    /// `encryptionKeyHex`.
    pub encryption_key: Vec<u8>,
    /// BCS-encoded class-groups decryption key. Local-only.
    pub decryption_key: Vec<u8>,
    pub signing_keypair: Ed25519KeyPair,
    pub curve: Curve,
}

impl UserShareEncryptionKeys {
    /// Derive the keypair set from a 32-byte seed. Matches the TS SDK
    /// `UserShareEncryptionKeys.fromRootSeedKey` V2 hash (curve byte
    /// is the numeric curve, not 0x00).
    pub fn from_root_seed_key(seed: &[u8; 32], curve: Curve) -> Result<Self> {
        let curve_byte = curve.as_u8();
        let cg_seed = derive_seed(CG_DOMAIN, curve_byte, seed);
        let signing_seed = derive_seed(ED_DOMAIN, curve_byte, seed);
        let (encryption_key, decryption_key) =
            generate_cg_keypair_from_seed(curve_byte as u32, cg_seed)
                .map_err(|e| MPCKitError::Crypto(format!("generate_cg_keypair_from_seed: {e}")))?;
        let private = Ed25519PrivateKey::from_bytes(&signing_seed)
            .map_err(|e| MPCKitError::Crypto(format!("Ed25519PrivateKey::from_bytes: {e}")))?;
        let signing_keypair = Ed25519KeyPair::from(private);
        Ok(Self {
            encryption_key,
            decryption_key,
            signing_keypair,
            curve,
        })
    }

    /// 32 bytes — the Ed25519 public key the encryption-key endpoint
    /// expects as `signerPublicKeyHex`.
    pub fn signing_public_key_bytes(&self) -> Vec<u8> {
        self.signing_keypair.public().as_bytes().to_vec()
    }

    /// Sui address derived from the Ed25519 public key
    /// (`blake2b256(0x00 || pubkey)`, 32 bytes, `0x` prefix).
    pub fn sui_address(&self) -> String {
        let mut hasher = Blake2b256::default();
        hasher.update([0u8]); // Ed25519 scheme flag
        hasher.update(self.signing_keypair.public().as_bytes());
        let digest = hasher.finalize();
        format!("0x{}", hex::encode(digest))
    }

    /// Ed25519 signature over the BCS-encoded encryption key. Backend
    /// verifies this in `/v1/encryption-keys` as proof of ownership.
    pub fn sign_encryption_key(&self) -> Vec<u8> {
        let sig = self.signing_keypair.sign(&self.encryption_key);
        sig.as_ref().to_vec()
    }

    /// Ed25519 signature over the dwallet's network-finalised public
    /// output (the bytes from `AwaitingKeyHolderSignature.public_output`).
    ///
    /// `user_public_output` is taken so callers can do a local
    /// consistency check before signing, matching the TS WASM
    /// signer's interface, but it is NOT part of the signed payload —
    /// only the dwallet's bytes are signed (verified against
    /// `crates/ika/src/dwallet_commands.rs:1805`). Sign the wrong
    /// payload and `accept_encrypted_user_share` aborts on the Move
    /// signature check.
    pub fn sign_user_output(
        &self,
        dwallet_public_output: &[u8],
        user_public_output: &[u8],
    ) -> Vec<u8> {
        debug_assert!(
            !user_public_output.is_empty(),
            "user_public_output should be the DKG-time public output for the local consistency check",
        );
        let _ = user_public_output;
        let sig = self.signing_keypair.sign(dwallet_public_output);
        sig.as_ref().to_vec()
    }
}

fn derive_seed(domain: &[u8], curve_byte: u8, seed: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::default();
    hasher.update(domain);
    hasher.update([curve_byte]);
    hasher.update(seed);
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_ref());
    out
}

/// Output of the centralized DKG ceremony. Exposed as four hex strings
/// matching the field names the backend expects.
pub struct DkgOutput {
    /// `userDKGMessage` — the centralized public key share + proof.
    pub user_dkg_message: Vec<u8>,
    /// `userPublicOutput` — the centralized output the user signs over
    /// during the accept step.
    pub user_public_output: Vec<u8>,
    /// Local-only. The backend never sees this. Persist alongside the
    /// dwallet so the user can sign later.
    pub user_secret_key_share: Vec<u8>,
    /// `encryptedCentralizedSecretShareAndProofHex` — the encrypted
    /// secret share + proof bound to the user's encryption key.
    pub encrypted_user_share_and_proof: Vec<u8>,
}

/// Run the centralized DKG ceremony. The bytes of `session_id_random`
/// are the user-provided random preimage; the on-chain session id is
/// derived from `(sender, session_id_random)` exactly as ika's Move
/// `register_session_identifier` does it, then mixed with a `User`
/// distinguisher per [`fastcrypto::hash::Keccak256`].
pub fn prepare_dkg(
    keys: &UserShareEncryptionKeys,
    protocol_pp: &[u8],
    session_id_random: &[u8],
    sender_address: &str,
) -> Result<DkgOutput> {
    let sender_bytes = parse_hex_address(sender_address)?;
    let session_id = compute_session_id(&sender_bytes, session_id_random);
    let curve_u32 = keys.curve.as_u8() as u32;
    let dkg = create_dkg_output_by_curve_v2(curve_u32, protocol_pp.to_vec(), session_id)
        .map_err(|e| MPCKitError::Crypto(format!("create_dkg_output_by_curve_v2: {e}")))?;
    let encrypted = encrypt_secret_key_share_and_prove_v2(
        curve_u32,
        dkg.centralized_secret_output.clone(),
        keys.encryption_key.clone(),
        protocol_pp.to_vec(),
    )
    .map_err(|e| MPCKitError::Crypto(format!("encrypt_secret_key_share_and_prove_v2: {e}")))?;
    Ok(DkgOutput {
        user_dkg_message: dkg.public_key_share_and_proof,
        user_public_output: dkg.public_output,
        user_secret_key_share: dkg.centralized_secret_output,
        encrypted_user_share_and_proof: encrypted,
    })
}

/// Centralized signature for the two-phase sign API. Binds together
/// the user's secret share, the presign bytes, and the message to
/// produce the input the backend's worker submits in phase 2.
#[allow(clippy::too_many_arguments)]
pub fn centralized_sign(
    protocol_pp: &[u8],
    dwallet_public_output: &[u8],
    user_secret_key_share: &[u8],
    presign_bytes: &[u8],
    message: &[u8],
    curve: Curve,
    sig_algo: SignatureAlgorithm,
    hash: Hash,
) -> Result<Vec<u8>> {
    let (relative_sig_algo, relative_hash) = relative_sig_and_hash(curve, sig_algo, hash)?;
    advance_centralized_sign_party(
        protocol_pp.to_vec(),
        dwallet_public_output.to_vec(),
        user_secret_key_share.to_vec(),
        presign_bytes.to_vec(),
        message.to_vec(),
        curve.as_u8() as u32,
        relative_sig_algo as u32,
        relative_hash as u32,
    )
    .map_err(|e| MPCKitError::Crypto(format!("advance_centralized_sign_party: {e}")))
}

/// Map our globally-numbered `(SignatureAlgorithm, Hash)` enums to the
/// chain-relative numbering the Move coordinator expects. The Move
/// coordinator + the upstream Rust crypto both index by
/// `(curve, signature_algorithm)` then by hash within that pair, so
/// `Hash::SHA256` is `0` for `(SECP256K1, Taproot)` but `1` for
/// `(SECP256K1, ECDSASecp256k1)`. This matches the TS SDK's
/// `SIG_ALGO_NUMBER` / `HASH_NUMBER` tables in `api.ts`.
///
/// Returns `(relative_sig_algo, relative_hash)`. Required input for
/// both [`centralized_sign`] (which calls into the centralized-party
/// crate) AND `SignPrepareRequest` (which the Move coordinator's
/// `validate_curve_and_signature_algorithm_and_hash_scheme` checks).
pub fn relative_sig_and_hash(
    curve: Curve,
    sig_algo: SignatureAlgorithm,
    hash: Hash,
) -> Result<(u8, u8)> {
    use Curve::*;
    use Hash::*;
    use SignatureAlgorithm::*;
    let invalid = || {
        MPCKitError::Invalid(format!(
            "invalid (curve, sig_algo, hash) combination: ({curve:?}, {sig_algo:?}, {hash:?})"
        ))
    };
    let (sig_idx, hash_idx): (u8, u8) = match (curve, sig_algo) {
        (Secp256k1, EcdsaSecp256k1) => (
            0,
            match hash {
                Keccak256 => 0,
                Sha256 => 1,
                DoubleSha256 => 2,
                _ => return Err(invalid()),
            },
        ),
        (Secp256k1, Taproot) => (
            1,
            match hash {
                Sha256 => 0,
                _ => return Err(invalid()),
            },
        ),
        (Secp256r1, EcdsaSecp256r1) => (
            0,
            match hash {
                Sha256 => 0,
                _ => return Err(invalid()),
            },
        ),
        (Ed25519, EdDsa) => (
            0,
            match hash {
                Sha512 => 0,
                _ => return Err(invalid()),
            },
        ),
        (Ristretto, SchnorrkelSubstrate) => (
            0,
            match hash {
                Merlin => 0,
                _ => return Err(invalid()),
            },
        ),
        _ => return Err(invalid()),
    };
    Ok((sig_idx, hash_idx))
}

/// Compute the on-chain session identifier the same way the upstream
/// `register_session_identifier` Move call does, then layer the
/// `SessionType::User` distinguisher on top so the network sees a
/// session id distinct from any system-initiated session with the
/// same preimage.
fn compute_session_id(sender_bytes: &[u8], user_bytes: &[u8]) -> Vec<u8> {
    // 1. preimage = keccak256(sender || user_bytes) — matches
    //    `on_chain_session_preimage` in dwallet_commands.rs.
    let preimage: [u8; 32] = {
        let mut hasher = Keccak256::default();
        hasher.update(sender_bytes);
        hasher.update(user_bytes);
        let digest = hasher.finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(digest.as_ref());
        out
    };
    // 2. session id = keccak256(version_be_bytes(0) || "USER" ||
    //    preimage). Same layout as `SessionIdentifier::new`.
    let mut hasher = Keccak256::default();
    hasher.update(0u64.to_be_bytes());
    hasher.update(b"USER");
    hasher.update(preimage);
    let digest = hasher.finalize();
    digest.as_ref().to_vec()
}

fn parse_hex_address(s: &str) -> Result<Vec<u8>> {
    let stripped = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(stripped)
        .map_err(|e| MPCKitError::Invalid(format!("invalid hex address {s:?}: {e}")))
}
