//! Per-step latency bench for the Rust SDK's onboard + sign
//! ceremonies. Mirrors `apps/backend/scripts/bench-detailed.ts`:
//! replicates the `MpcKit::onboard` / `MpcKit::sign` orchestration
//! step by step so each primitive's wall-clock cost is measurable,
//! then reports min / avg / p50 / p95 / p99 / max per step + per
//! category (`crypto` / `http-api` / `mpc-wait`).
//!
//! Requires the `crypto` feature.
//!
//! Required env (mirroring the TS bench):
//!   - MPCKIT_API_KEY              api key for an existing funded user
//!   - BACKEND_URL              default http://localhost:3000
//!   - IKA_NETWORK              "testnet" or "mainnet"; default testnet
//!   - E2E_USER_SEED_HEX        32 bytes hex; default 0x42 repeated
//!   - BENCH_CURVE              SECP256K1 / SECP256R1 / ED25519 / RISTRETTO
//!   - BENCH_SIGN_ITERS         default 4
//!
//! Run:
//!   cargo run --release --example bench_detailed --features crypto
use std::collections::HashMap;
use std::env;
use std::time::{Duration, Instant};

use mpckit::{
    centralized_sign, prepare_dkg, relative_sig_and_hash, Curve, EncryptionKeyCreate, Hash, MpcKit,
    Network, OnboardZeroTrustRequest, SignPrepareRequest, SignRequestStatus, SignSubmitRequest,
    SignatureAlgorithm, UserShareEncryptionKeys,
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
enum Category {
    Crypto,
    HttpApi,
    McpWait,
}

impl Category {
    fn label(self) -> &'static str {
        match self {
            Self::Crypto => "crypto",
            Self::HttpApi => "http-api",
            Self::McpWait => "mpc-wait",
        }
    }
}

struct Step {
    name: &'static str,
    cat: Category,
    ms: f64,
}

fn fmt_ms(ms: f64) -> String {
    if ms < 1000.0 {
        format!("{ms:>5.0} ms")
    } else {
        format!("{:>5.2} s", ms / 1000.0)
    }
}

fn quantile(samples: &[f64], q: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((q * sorted.len() as f64).ceil() as usize).saturating_sub(1);
    sorted[idx.min(sorted.len() - 1)]
}

fn avg(samples: &[f64]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.iter().sum::<f64>() / samples.len() as f64
}

async fn timed<F, T>(steps: &mut Vec<Step>, name: &'static str, cat: Category, f: F) -> T
where
    F: std::future::Future<Output = T>,
{
    let t0 = Instant::now();
    let v = f.await;
    steps.push(Step {
        name,
        cat,
        ms: t0.elapsed().as_secs_f64() * 1000.0,
    });
    v
}

fn parse_curve(s: &str) -> Option<Curve> {
    match s.to_uppercase().as_str() {
        "SECP256K1" => Some(Curve::Secp256k1),
        "SECP256R1" => Some(Curve::Secp256r1),
        "ED25519" => Some(Curve::Ed25519),
        "RISTRETTO" => Some(Curve::Ristretto),
        _ => None,
    }
}

fn default_sign_spec(curve: Curve) -> (SignatureAlgorithm, Hash) {
    match curve {
        Curve::Secp256k1 => (SignatureAlgorithm::Taproot, Hash::Sha256),
        Curve::Secp256r1 => (SignatureAlgorithm::EcdsaSecp256r1, Hash::Sha256),
        Curve::Ed25519 => (SignatureAlgorithm::EdDsa, Hash::Sha512),
        Curve::Ristretto => (SignatureAlgorithm::SchnorrkelSubstrate, Hash::Merlin),
    }
}

fn parse_seed(hex_str: &str) -> [u8; 32] {
    let stripped = hex_str.strip_prefix("0x").unwrap_or(hex_str);
    let bytes = hex::decode(stripped).expect("E2E_USER_SEED_HEX must be valid hex");
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&bytes[..32]);
    seed
}

fn random_bytes_32() -> Vec<u8> {
    let mut out = Vec::with_capacity(32);
    out.extend_from_slice(Uuid::new_v4().as_bytes());
    out.extend_from_slice(Uuid::new_v4().as_bytes());
    out
}

async fn onboard_breakdown(
    api: &MpcKit,
    curve: Curve,
    seed: &[u8; 32],
) -> Result<(Vec<Step>, OnboardOutcome), Box<dyn std::error::Error>> {
    let mut steps = Vec::new();

    // 1. Local key derivation.
    let keys = timed(
        &mut steps,
        "openSession (key derivation)",
        Category::Crypto,
        async { UserShareEncryptionKeys::from_root_seed_key(seed, curve) },
    )
    .await?;
    let signing_pub_hex = hex::encode(keys.signing_public_key_bytes());

    // 2. Sign encryption key (Ed25519).
    let enc_sig_hex = timed(
        &mut steps,
        "signEncryptionKey (Ed25519)",
        Category::Crypto,
        async { hex::encode(keys.sign_encryption_key()) },
    )
    .await;

    // 3. Register encryption key on chain (HTTP).
    let encryption_key = timed(
        &mut steps,
        "POST /v1/encryption-keys (Move + DB)",
        Category::HttpApi,
        api.register_encryption_key(&EncryptionKeyCreate {
            curve: curve.as_u8(),
            encryption_key_hex: &hex::encode(&keys.encryption_key),
            encryption_key_signature_hex: &enc_sig_hex,
            signer_public_key_hex: &signing_pub_hex,
        }),
    )
    .await?;

    // 4 + 5. Network info + protocol params (run in parallel like the
    // SDK does).
    let net_t0 = Instant::now();
    let (network, protocol_pp) =
        tokio::try_join!(api.network_info(), api.protocol_parameters(curve))?;
    let net_paired_ms = net_t0.elapsed().as_secs_f64() * 1000.0;
    // Account the wall-clock to /v1/network (the longer of the pair on
    // average); /v1/protocol-parameters is in-process cached after
    // this call so its second-and-after cost is ~0.
    steps.push(Step {
        name: "GET /v1/network + /v1/protocol-parameters (parallel)",
        cat: Category::HttpApi,
        ms: net_paired_ms,
    });

    // 6. Native DKG ceremony.
    let session_id_random = random_bytes_32();
    let dkg = timed(
        &mut steps,
        "prepare_dkg (native centralized-party)",
        Category::Crypto,
        async {
            prepare_dkg(
                &keys,
                &protocol_pp,
                &session_id_random,
                &network.operator_address,
            )
        },
    )
    .await?;

    // 7. Submit DKG PTB.
    let onboard_resp = timed(
        &mut steps,
        "POST /v1/dwallets (Move + DB)",
        Category::HttpApi,
        api.onboard_zero_trust(&OnboardZeroTrustRequest {
            encryption_key_id: &encryption_key.id,
            dwallet_network_encryption_key_id: &network.latest_encryption_key.id,
            centralized_public_key_share_and_proof_hex: &hex::encode(&dkg.user_dkg_message),
            encrypted_centralized_secret_share_and_proof_hex: &hex::encode(
                &dkg.encrypted_user_share_and_proof,
            ),
            user_public_output_hex: &hex::encode(&dkg.user_public_output),
            signer_public_key_hex: &signing_pub_hex,
            session_identifier_hex: &hex::encode(&session_id_random),
        }),
    )
    .await?;

    // 8. Wait for the network to finalise the dwallet (mpc-wait).
    let awaiting_state = timed(
        &mut steps,
        "MPC wait: dwallet → AwaitingKeyHolderSignature",
        Category::McpWait,
        api.dwallet_onchain_state(&onboard_resp.dwallet.id, "awaiting_user_share", 600_000),
    )
    .await?;
    let dwallet_public_output = hex::decode(
        awaiting_state
            .public_output_hex
            .strip_prefix("0x")
            .unwrap_or(&awaiting_state.public_output_hex),
    )?;

    // 9. Sign the dwallet's public output.
    let user_out_sig_hex = timed(
        &mut steps,
        "signUserOutput (Ed25519 over public_output)",
        Category::Crypto,
        async {
            hex::encode(keys.sign_user_output(&dwallet_public_output, &dkg.user_public_output))
        },
    )
    .await;

    // 10. Accept.
    let accept = timed(
        &mut steps,
        "POST /v1/dwallets/:id/accept (Move + DB)",
        Category::HttpApi,
        api.accept_user_share(
            &onboard_resp.dwallet.id,
            &onboard_resp.encrypted_user_secret_key_share_id,
            &user_out_sig_hex,
        ),
    )
    .await?;

    Ok((
        steps,
        OnboardOutcome {
            dwallet_id: accept.dwallet.id,
            user_secret_key_share_hex: hex::encode(&dkg.user_secret_key_share),
        },
    ))
}

struct OnboardOutcome {
    dwallet_id: String,
    user_secret_key_share_hex: String,
}

async fn sign_breakdown(
    api: &MpcKit,
    onboard: &OnboardOutcome,
    curve: Curve,
    sig_algo: SignatureAlgorithm,
    hash: Hash,
    iter: usize,
) -> Result<Vec<Step>, Box<dyn std::error::Error>> {
    let mut steps = Vec::new();
    let message = format!("bench-{iter}-{}", chrono_now()).into_bytes();
    let idem = format!("bench-rust-{iter}-{}", Uuid::new_v4());

    // Move coordinator validates `(sig, hash)` per chain-relative
    // numbering — same remap the high-level `MpcKit::sign` does
    // internally before posting phase 1.
    let (rel_sig, rel_hash) = relative_sig_and_hash(curve, sig_algo, hash)?;

    // Phase 1: reserve a presign.
    let prepared = timed(
        &mut steps,
        "POST /v1/sign (phase 1: prepare)",
        Category::HttpApi,
        api.sign_prepare(
            &idem,
            &SignPrepareRequest {
                dwallet_id: &onboard.dwallet_id,
                signature_algorithm: rel_sig,
                hash_scheme: rel_hash,
                message_hex: &hex::encode(&message),
            },
        ),
    )
    .await?;

    // Active dwallet state + protocol params (parallel, like in
    // MpcKit::sign).
    let active_t0 = Instant::now();
    let (active_state, protocol_pp) = tokio::try_join!(
        api.dwallet_onchain_state(&onboard.dwallet_id, "active", 60_000),
        api.protocol_parameters(curve)
    )?;
    let pair_ms = active_t0.elapsed().as_secs_f64() * 1000.0;
    steps.push(Step {
        name: "MPC wait: dwallet → Active + protocol params",
        cat: Category::McpWait,
        ms: pair_ms,
    });
    let dwallet_public_output = hex::decode(
        active_state
            .public_output_hex
            .strip_prefix("0x")
            .unwrap_or(&active_state.public_output_hex),
    )?;
    let user_secret = hex::decode(&onboard.user_secret_key_share_hex)?;

    // Phase 1.5: native centralized signature.
    let centralized = timed(
        &mut steps,
        "centralized_sign (native centralized-party)",
        Category::Crypto,
        async {
            centralized_sign(
                &protocol_pp,
                &dwallet_public_output,
                &user_secret,
                &hex::decode(&prepared.presign_bytes_hex).unwrap(),
                &message,
                curve,
                sig_algo,
                hash,
            )
        },
    )
    .await?;

    // Phase 2: submit.
    let session_id_random = random_bytes_32();
    timed(
        &mut steps,
        "POST /v1/sign/:id/submit (phase 2)",
        Category::HttpApi,
        api.sign_submit(
            &prepared.sign_request.id,
            &SignSubmitRequest {
                message_centralized_signature_hex: &hex::encode(&centralized),
                session_identifier_hex: &hex::encode(&session_id_random),
            },
        ),
    )
    .await?;

    // Poll until completed.
    let poll_t0 = Instant::now();
    loop {
        let req = api.get_sign_request(&prepared.sign_request.id).await?;
        match req.status {
            SignRequestStatus::Completed => break,
            SignRequestStatus::Failed => {
                return Err(format!(
                    "sign failed: code={:?} message={:?}",
                    req.error_code, req.error_message
                )
                .into());
            }
            _ => {}
        }
        if poll_t0.elapsed() > Duration::from_secs(240) {
            return Err("sign poll timeout".into());
        }
        tokio::time::sleep(Duration::from_millis(1500)).await;
    }
    steps.push(Step {
        name: "MPC wait: GET /v1/sign/:id → completed",
        cat: Category::McpWait,
        ms: poll_t0.elapsed().as_secs_f64() * 1000.0,
    });

    Ok(steps)
}

fn chrono_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn print_breakdown(label: &str, runs: &[Vec<Step>]) {
    println!("\n[bench] === {label} (n={}) ===", runs.len());
    if runs.is_empty() {
        return;
    }
    // Group samples by step name.
    let names: Vec<&str> = runs[0].iter().map(|s| s.name).collect();
    let mut grouped: HashMap<&str, (Category, Vec<f64>)> = HashMap::new();
    for run in runs {
        for s in run {
            let entry = grouped.entry(s.name).or_insert((s.cat, Vec::new()));
            entry.1.push(s.ms);
        }
    }
    let total_avg: f64 = runs
        .iter()
        .map(|run| run.iter().map(|s| s.ms).sum::<f64>())
        .sum::<f64>()
        / runs.len() as f64;
    let name_w = names.iter().map(|s| s.len()).max().unwrap_or(20).max(40);
    println!(
        "  {:<width$} {:>10} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}",
        "step",
        "cat",
        "min",
        "avg",
        "p50",
        "p95",
        "p99",
        "max",
        width = name_w
    );
    println!("  {}", "-".repeat(name_w + 70));
    let mut cat_totals: HashMap<Category, f64> = HashMap::new();
    for name in &names {
        let entry = grouped.get(*name).expect("step always present");
        let xs = &entry.1;
        let mn = xs.iter().cloned().fold(f64::INFINITY, f64::min);
        let mx = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let a = avg(xs);
        let p50 = quantile(xs, 0.50);
        let p95 = quantile(xs, 0.95);
        let p99 = quantile(xs, 0.99);
        *cat_totals.entry(entry.0).or_insert(0.0) += a;
        println!(
            "  {:<width$} [{:^8}] {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}",
            name,
            entry.0.label(),
            fmt_ms(mn),
            fmt_ms(a),
            fmt_ms(p50),
            fmt_ms(p95),
            fmt_ms(p99),
            fmt_ms(mx),
            width = name_w
        );
    }
    println!("  {}", "-".repeat(name_w + 70));
    for cat in [Category::Crypto, Category::HttpApi, Category::McpWait] {
        let v = cat_totals.get(&cat).copied().unwrap_or(0.0);
        let pct = if total_avg > 0.0 {
            v / total_avg * 100.0
        } else {
            0.0
        };
        println!(
            "  {:<10} subtotal: {} ({:.1}%)",
            cat.label(),
            fmt_ms(v),
            pct
        );
    }
    println!("  total avg: {}", fmt_ms(total_avg));

    // Trip totals (sum of step ms per run) — these are the per-iteration
    // wall-clock numbers. Useful for the headline p50/p99 the user
    // sees in dashboards.
    let totals: Vec<f64> = runs.iter().map(|r| r.iter().map(|s| s.ms).sum()).collect();
    let mn = totals.iter().cloned().fold(f64::INFINITY, f64::min);
    let mx = totals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    println!(
        "  trip   min={} avg={} p50={} p95={} p99={} max={}",
        fmt_ms(mn),
        fmt_ms(avg(&totals)),
        fmt_ms(quantile(&totals, 0.50)),
        fmt_ms(quantile(&totals, 0.95)),
        fmt_ms(quantile(&totals, 0.99)),
        fmt_ms(mx),
    );
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api_key = env::var("MPCKIT_API_KEY").expect("MPCKIT_API_KEY required");
    let backend_url = env::var("BACKEND_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    let network_str = env::var("IKA_NETWORK").unwrap_or_else(|_| "testnet".into());
    let network = match network_str.as_str() {
        "mainnet" => Network::Mainnet,
        _ => Network::Testnet,
    };
    let curve_str = env::var("BENCH_CURVE").unwrap_or_else(|_| "SECP256K1".into());
    let curve =
        parse_curve(&curve_str).ok_or_else(|| format!("unknown BENCH_CURVE: {curve_str}"))?;
    let seed_hex = env::var("E2E_USER_SEED_HEX").unwrap_or_else(|_| "42".repeat(32));
    let seed = parse_seed(&seed_hex);
    // Per-curve seed so we don't reuse another curve's encryption-key
    // address (matches the matrix bench convention).
    let curve_seed = {
        use fastcrypto::hash::{HashFunction, Keccak256};
        let mut hasher = Keccak256::default();
        hasher.update(seed);
        hasher.update([curve.as_u8()]);
        hasher.update(b"bench-detailed-rust");
        let digest = hasher.finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(digest.as_ref());
        out
    };
    let sign_iters: usize = env::var("BENCH_SIGN_ITERS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4);

    let api = MpcKit::builder()
        .base_url(&backend_url)
        .api_key(&api_key)
        .network(network)
        .build()?;

    eprintln!("[bench] curve={curve_str} signIters={sign_iters} backend={backend_url} sdk=rust");

    let bal_start = api.balance().await?;
    eprintln!("[bench] balance: {}", bal_start.credits_micro);

    let onboard_t0 = Instant::now();
    let (onboard_steps, onboard) = onboard_breakdown(&api, curve, &curve_seed).await?;
    let onboard_total = onboard_t0.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "[bench] onboard total: {} (dwallet={})",
        fmt_ms(onboard_total),
        onboard.dwallet_id
    );

    let (sig_algo, hash) = default_sign_spec(curve);
    let mut sign_runs: Vec<Vec<Step>> = Vec::new();
    for i in 1..=sign_iters {
        let t0 = Instant::now();
        match sign_breakdown(&api, &onboard, curve, sig_algo, hash, i).await {
            Ok(run) => {
                let trip = t0.elapsed().as_secs_f64() * 1000.0;
                eprintln!("[bench] sign #{i}: {}", fmt_ms(trip));
                sign_runs.push(run);
            }
            Err(e) => eprintln!("[bench] sign #{i} failed: {e}"),
        }
    }

    print_breakdown("onboard", &[onboard_steps]);
    if !sign_runs.is_empty() {
        print_breakdown(
            &format!("sign ({:?}, {:?}, {:?})", curve, sig_algo, hash),
            &sign_runs,
        );
    }

    let bal_end = api.balance().await?;
    eprintln!(
        "\n[bench] balance: {} -> {} micro-credits",
        bal_start.credits_micro, bal_end.credits_micro
    );

    Ok(())
}
