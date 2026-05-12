//! `mpckit` - Rust SDK for MPCKit.
//!
//! v1 covers the HTTP surface only: introspection, billing, dwallet
//! state, and the two-phase sign API. The high-level zero-trust DKG +
//! centralized signature ceremonies require WASM-equivalent crypto;
//! that lands in a future crate version behind a `crypto` feature
//! once the upstream Rust crate is wired in.
//!
//! ```no_run
//! use mpckit::{MPCKit, Network};
//!
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! // Defaults to https://api.testnet.mpckit.xyz for testnet,
//! // https://api.mpckit.xyz for mainnet. Pass `.base_url(...)` to override
//! // (self-hosting, dev).
//! let api = MPCKit::builder()
//!     .api_key("mpckit_test_…")
//!     .network(Network::Testnet)
//!     .build()?;
//!
//! let pricing = api.billing_pricing().await?;
//! println!("min deposit micro: {}", pricing.min_deposit_micro);
//! # Ok(()) }
//! ```

mod client;
mod constants;
mod error;
mod types;

#[cfg(feature = "crypto")]
mod crypto;

pub use client::{new_idempotency_key, Balance, MPCKit, MPCKitBuilder};
#[cfg(feature = "crypto")]
pub use client::{OnboardArgs, OnboardResult, SignArgs, SignResult};
pub use constants::{Curve, Hash, Network, SignatureAlgorithm};
#[cfg(feature = "crypto")]
pub use crypto::{
    centralized_sign, prepare_dkg, relative_sig_and_hash, DkgOutput, UserShareEncryptionKeys,
};
pub use error::{MPCKitError, Result};
pub use types::{
    AcceptDWalletResponse, ApiKey, BillingCharge, BillingDeposit, BillingHistory, BillingPricing,
    DWallet, DWalletKind, DWalletResponse, DWalletStatus, DepositAddress, DepositDeclareResponse,
    DwalletList, EncryptionKey, EncryptionKeyCreate, Health, NetworkInfo, OnboardZeroTrustRequest,
    OnboardZeroTrustResponse, ProtocolParametersResponse, SignPrepareRequest, SignPrepareResponse,
    SignRequest, SignRequestStatus, SignSubmitRequest, SignSubmitResponse, User,
};
