//! Wire types mirroring the backend route shapes. Naming matches the
//! TS SDK so cross-language users can find the same fields. We keep
//! `String` for hex-encoded byte arrays (the wire format is hex) and
//! decode them at call sites that actually need bytes.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub service: String,
    pub uptime: f64,
    pub now: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    /// Sui address that submits DKG/sign PTBs. The DKG message is
    /// bound to this address; SDK's `prepareDKG` callers MUST use this
    /// as `senderAddress`.
    #[serde(rename = "operatorAddress")]
    pub operator_address: String,
    pub packages: NetworkPackages,
    pub objects: NetworkObjects,
    #[serde(rename = "latestEncryptionKey")]
    pub latest_encryption_key: NetworkEncryptionKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPackages {
    #[serde(rename = "ikaPackage")]
    pub ika_package: String,
    #[serde(rename = "ikaDwallet2pcMpcPackage")]
    pub ika_dwallet_2pc_mpc_package: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkObjects {
    pub coordinator: String,
    pub system: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEncryptionKey {
    pub id: String,
    pub epoch: u64,
    #[serde(rename = "loadedAt")]
    pub loaded_at: u64,
}

/// Wire shape for `GET /v1/protocol-parameters?curve=N`. Backend ships
/// the 44 MB blob base64-encoded; the high-level
/// [`crate::MpcKit::protocol_parameters`] helper decodes + caches the
/// bytes for you. Use this struct directly only if you need the raw
/// envelope (e.g. inspecting `epoch` / `loaded_at` for cache
/// invalidation triggers).
///
/// Note: `curve` is the enum *string* form (`"SECP256K1"`, …), not
/// the numeric form, because that's what the backend returns from this
/// endpoint. Other endpoints (e.g. `/v1/encryption-keys`,
/// `/v1/dwallets`) ship the numeric form. We deserialise into the
/// strongly-typed [`crate::Curve`] either way.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolParametersResponse {
    pub curve: crate::Curve,
    #[serde(rename = "encryptionKeyId")]
    pub encryption_key_id: String,
    pub epoch: u64,
    #[serde(rename = "loadedAt")]
    pub loaded_at: u64,
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
    #[serde(rename = "bytesLength")]
    pub bytes_length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    #[serde(rename = "isAdmin")]
    pub is_admin: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub scopes: Vec<String>,
    #[serde(rename = "lastUsedAt")]
    pub last_used_at: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionKey {
    pub id: String,
    pub curve: u8,
    #[serde(rename = "suiObjectId")]
    pub sui_object_id: String,
    #[serde(rename = "suiAddress")]
    pub sui_address: String,
    #[serde(rename = "suiTxDigest")]
    pub sui_tx_digest: String,
    #[serde(rename = "createdAt", default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncryptionKeyCreate<'a> {
    pub curve: u8,
    #[serde(rename = "encryptionKeyHex")]
    pub encryption_key_hex: &'a str,
    #[serde(rename = "encryptionKeySignatureHex")]
    pub encryption_key_signature_hex: &'a str,
    #[serde(rename = "signerPublicKeyHex")]
    pub signer_public_key_hex: &'a str,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DWalletKind {
    ZeroTrust,
    Shared,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DWalletStatus {
    Submitting,
    AwaitingUserShare,
    Active,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DWallet {
    pub id: String,
    #[serde(rename = "accountId")]
    pub account_id: Option<String>,
    #[serde(rename = "suiDwalletId")]
    pub sui_dwallet_id: String,
    pub curve: u8,
    pub kind: DWalletKind,
    pub status: DWalletStatus,
    #[serde(rename = "encryptionKeyId")]
    pub encryption_key_id: String,
    #[serde(rename = "dkgTxDigest")]
    pub dkg_tx_digest: Option<String>,
    #[serde(rename = "acceptTxDigest")]
    pub accept_tx_digest: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DwalletList {
    pub dwallets: Vec<DWallet>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DWalletResponse {
    pub dwallet: DWallet,
}

/// Wire shape for `GET /v1/dwallets/:id/onchain-state?status=…`. The
/// backend proxies a Sui gRPC query to read the dwallet object and
/// returns just the bytes the Rust SDK needs for its accept / sign
/// signatures. Hex-encoded for transport; the high-level
/// [`crate::MpcKit::onboard`] / [`crate::MpcKit::sign`] decode it
/// before passing into the centralized-party crate.
#[derive(Debug, Clone, Deserialize)]
pub struct DWalletOnchainState {
    #[serde(rename = "suiDwalletId")]
    pub sui_dwallet_id: String,
    pub status: String,
    #[serde(rename = "publicOutputHex")]
    pub public_output_hex: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OnboardZeroTrustRequest<'a> {
    #[serde(rename = "encryptionKeyId")]
    pub encryption_key_id: &'a str,
    #[serde(rename = "dwalletNetworkEncryptionKeyId")]
    pub dwallet_network_encryption_key_id: &'a str,
    #[serde(rename = "centralizedPublicKeyShareAndProofHex")]
    pub centralized_public_key_share_and_proof_hex: &'a str,
    #[serde(rename = "encryptedCentralizedSecretShareAndProofHex")]
    pub encrypted_centralized_secret_share_and_proof_hex: &'a str,
    #[serde(rename = "userPublicOutputHex")]
    pub user_public_output_hex: &'a str,
    #[serde(rename = "signerPublicKeyHex")]
    pub signer_public_key_hex: &'a str,
    #[serde(rename = "sessionIdentifierHex")]
    pub session_identifier_hex: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OnboardZeroTrustResponse {
    pub account: AccountRef,
    pub dwallet: DWallet,
    #[serde(rename = "txDigest")]
    pub tx_digest: String,
    #[serde(rename = "encryptedUserSecretKeyShareId")]
    pub encrypted_user_secret_key_share_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AccountRef {
    pub id: String,
    #[serde(rename = "suiObjectId")]
    pub sui_object_id: String,
    #[serde(rename = "createdInThisTx")]
    pub created_in_this_tx: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AcceptDWalletResponse {
    pub dwallet: DWallet,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignRequestStatus {
    Prepared,
    Queued,
    Submitted,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SignRequest {
    pub id: String,
    pub status: SignRequestStatus,
    #[serde(rename = "txDigest")]
    pub tx_digest: Option<String>,
    #[serde(rename = "signSessionId")]
    pub sign_session_id: Option<String>,
    #[serde(rename = "signatureHex")]
    pub signature_hex: Option<String>,
    #[serde(rename = "errorCode")]
    pub error_code: Option<String>,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SignPrepareRequest<'a> {
    #[serde(rename = "dwalletId")]
    pub dwallet_id: &'a str,
    #[serde(rename = "signatureAlgorithm")]
    pub signature_algorithm: u8,
    #[serde(rename = "hashScheme")]
    pub hash_scheme: u8,
    #[serde(rename = "messageHex")]
    pub message_hex: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SignPrepareResponse {
    #[serde(rename = "signRequest")]
    pub sign_request: SignRequest,
    pub duplicate: bool,
    #[serde(rename = "presignBytesHex")]
    pub presign_bytes_hex: String,
    #[serde(rename = "presignSuiObjectId")]
    pub presign_sui_object_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SignSubmitRequest<'a> {
    #[serde(rename = "messageCentralizedSignatureHex")]
    pub message_centralized_signature_hex: &'a str,
    #[serde(rename = "sessionIdentifierHex")]
    pub session_identifier_hex: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SignSubmitResponse {
    #[serde(rename = "signRequest")]
    pub sign_request: SignRequest,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DepositAddress {
    pub address: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BillingDeposit {
    pub id: String,
    #[serde(rename = "txDigest")]
    pub tx_digest: String,
    #[serde(rename = "senderAddress")]
    pub sender_address: String,
    #[serde(rename = "coinType")]
    pub coin_type: String,
    #[serde(rename = "amountAtomic")]
    pub amount_atomic: String,
    /// microUSD credited (1 microUSD = $0.000001).
    #[serde(rename = "creditsMicro")]
    pub credits_micro: String,
    /// `creditsMicro` rendered as a USD string, e.g. "1.234567".
    #[serde(rename = "creditsUsd")]
    pub credits_usd: String,
    #[serde(rename = "sweepStatus")]
    pub sweep_status: String,
    #[serde(rename = "sweepTxDigest")]
    pub sweep_tx_digest: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "sweptAt")]
    pub swept_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BillingCharge {
    pub id: String,
    #[serde(rename = "opType")]
    pub op_type: String,
    #[serde(rename = "opId")]
    pub op_id: String,
    pub kind: String,
    /// Signed microUSD: charges negative, refunds positive.
    #[serde(rename = "creditsMicro")]
    pub credits_micro: String,
    /// Same as `credits_micro` rendered as a USD string.
    #[serde(rename = "creditsUsd")]
    pub credits_usd: String,
    pub reason: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BillingHistory {
    pub deposits: Vec<BillingDeposit>,
    pub charges: Vec<BillingCharge>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DepositDeclareResponse {
    pub deposit: BillingDeposit,
    pub duplicate: bool,
    #[serde(rename = "creditsMicro")]
    pub credits_micro: String,
    #[serde(rename = "creditsUsd")]
    pub credits_usd: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PriceFeedStatus {
    pub source: String,
    #[serde(rename = "loadedAt")]
    pub loaded_at: u64,
    #[serde(rename = "lastFeedSuccessAt", default)]
    pub last_feed_success_at: u64,
    #[serde(default)]
    pub stale: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BillingPricing {
    /// Always "microUSD" — 1 microUSD = $0.000001.
    pub unit: String,
    /// microUSD per 1 USD; always 1_000_000.
    #[serde(rename = "microPerUsd")]
    pub micro_per_usd: u64,
    /// Op prices in microUSD.
    pub ops: std::collections::HashMap<String, u64>,
    /// Op prices rendered as USD strings.
    #[serde(rename = "opsUsd")]
    pub ops_usd: std::collections::HashMap<String, String>,
    #[serde(rename = "acceptedCoinTypes")]
    pub accepted_coin_types: Vec<String>,
    #[serde(rename = "minDepositMicro")]
    pub min_deposit_micro: u64,
    #[serde(rename = "minDepositUsd")]
    pub min_deposit_usd: String,
    /// Live USD prices per accepted coin (microUSD per 1 whole coin).
    #[serde(rename = "coinPricesUsd")]
    pub coin_prices_usd: std::collections::HashMap<String, String>,
    #[serde(rename = "priceFeed")]
    pub price_feed: PriceFeedStatus,
}
