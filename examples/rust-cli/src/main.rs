//! Minimal Rust SDK demo. Mirrors `examples/ts-node/src/index.ts`:
//! derive identity from a seed, onboard a zero-trust dwallet, sign
//! one message, print the result.
//!
//! Build:    cargo build --release -p mpckit-example-rust-cli
//! Run:      MPCKIT_API_KEY=mpckit_test_… \
//!           cargo run --release -p mpckit-example-rust-cli
//!
//! Optional env:
//!   MPCKIT_NETWORK   testnet (default) | mainnet
//!   MPCKIT_SEED_HEX  32 bytes hex seed (default: 0x42 repeated)
//!   MPCKIT_BASE_URL  override the default hosted endpoint (self-hosting / dev)

use std::env;
use std::process::ExitCode;

use mpckit::{Curve, Hash, MpcKit, Network, OnboardArgs, SignArgs, SignatureAlgorithm};

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(err) = run().await {
        eprintln!("error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let api_key = required("MPCKIT_API_KEY")?;
    let base_url = env::var("MPCKIT_BASE_URL").ok();
    let network = match env::var("MPCKIT_NETWORK").as_deref() {
        Ok("mainnet") => Network::Mainnet,
        _ => Network::Testnet,
    };
    let seed_hex = env::var("MPCKIT_SEED_HEX").unwrap_or_else(|_| "42".repeat(32));
    let seed_bytes = hex::decode(seed_hex.strip_prefix("0x").unwrap_or(&seed_hex))?;
    if seed_bytes.len() != 32 {
        return Err("MPCKIT_SEED_HEX must be 32 bytes".into());
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&seed_bytes);

    let mut builder = MpcKit::builder().api_key(&api_key).network(network);
    if let Some(url) = base_url.as_deref() {
        builder = builder.base_url(url);
    }
    let api = builder.build()?;

    let balance = api.balance().await?;
    println!(
        "balance: ${} ({} microUSD)",
        balance.credits_usd, balance.credits_micro,
    );

    let onboard = api
        .onboard(OnboardArgs {
            seed: &seed,
            curve: Curve::Secp256k1,
            timeout: None,
        })
        .await?;
    println!("dwallet: {}", onboard.dwallet.sui_dwallet_id);

    let message = b"hello, ika";
    let result = api
        .sign(SignArgs {
            seed: &seed,
            dwallet_id: &onboard.dwallet.id,
            curve: Curve::Secp256k1,
            signature_algorithm: SignatureAlgorithm::Taproot,
            hash_scheme: Hash::Sha256,
            message,
            user_secret_key_share_hex: &onboard.user_secret_key_share_hex,
            idempotency_key: None,
            timeout: None,
        })
        .await?;
    println!("signature: {}", hex::encode(&result.signature));
    Ok(())
}

fn required(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    env::var(name).map_err(|_| format!("missing env {name}").into())
}
