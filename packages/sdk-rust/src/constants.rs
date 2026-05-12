use serde::{Deserialize, Serialize};

/// Sui network the backend is configured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    Testnet,
    Mainnet,
}

impl Network {
    /// Hosted MPCKit base URL for this network. The Rust builder
    /// uses this when `base_url(...)` is not set explicitly.
    pub fn default_base_url(self) -> &'static str {
        match self {
            Network::Mainnet => "https://api.mpckit.xyz",
            Network::Testnet => "https://api.testnet.mpckit.xyz",
        }
    }
}

/// Curve identifier matching `@ika.xyz/sdk` and the Move module's
/// `curve` parameter. Numeric forms (used by routes) are exposed via
/// `as u8`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Curve {
    #[serde(rename = "SECP256K1")]
    Secp256k1 = 0,
    #[serde(rename = "SECP256R1")]
    Secp256r1 = 1,
    #[serde(rename = "ED25519")]
    Ed25519 = 2,
    #[serde(rename = "RISTRETTO")]
    Ristretto = 3,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignatureAlgorithm {
    #[serde(rename = "ECDSASecp256k1")]
    EcdsaSecp256k1 = 0,
    #[serde(rename = "Taproot")]
    Taproot = 1,
    #[serde(rename = "ECDSASecp256r1")]
    EcdsaSecp256r1 = 2,
    #[serde(rename = "EdDSA")]
    EdDsa = 3,
    #[serde(rename = "SchnorrkelSubstrate")]
    SchnorrkelSubstrate = 4,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Hash {
    #[serde(rename = "KECCAK256")]
    Keccak256 = 0,
    #[serde(rename = "SHA256")]
    Sha256 = 1,
    #[serde(rename = "DoubleSHA256")]
    DoubleSha256 = 2,
    #[serde(rename = "SHA512")]
    Sha512 = 3,
    #[serde(rename = "Merlin")]
    Merlin = 4,
}

impl Curve {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

impl SignatureAlgorithm {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

impl Hash {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}
