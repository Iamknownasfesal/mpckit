//! HTTP client for MpcKit. Mirrors the TS SDK's
//! `MpcKit` surface: introspection, billing, dwallets, sign. Methods
//! return strongly-typed deserialised responses; non-2xx responses
//! map to [`crate::MpcKitError`] preserving the wire `code` so
//! callers can branch on `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, etc.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::sync::RwLock;
use url::Url;
use uuid::Uuid;

use crate::constants::{Curve, Network};
use crate::error::{MpcKitError, Result};
use crate::types::{
    AcceptDWalletResponse, BillingHistory, BillingPricing, DWalletResponse, DepositAddress,
    DepositDeclareResponse, DwalletList, EncryptionKey, EncryptionKeyCreate, Health, NetworkInfo,
    OnboardZeroTrustRequest, OnboardZeroTrustResponse, ProtocolParametersResponse,
    SignPrepareRequest, SignPrepareResponse, SignRequest, SignSubmitRequest, SignSubmitResponse,
};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Async client for MpcKit.
#[derive(Debug, Clone)]
pub struct MpcKit {
    inner: Client,
    base_url: Url,
    network: Network,
    /// Per-instance cache for /v1/protocol-parameters bytes. Backend
    /// already pre-computes + caches the 44 MB blob on its end (LRU
    /// keyed on `(curve, networkEncryptionKeyId)`); the SDK-side cache
    /// avoids re-paying even the ~100 ms HTTP roundtrip on hot paths.
    /// `Arc<RwLock<...>>` so cloning the client shares one cache.
    protocol_parameters_cache: Arc<RwLock<HashMap<Curve, Vec<u8>>>>,
}

impl MpcKit {
    pub fn builder() -> MpcKitBuilder {
        MpcKitBuilder::default()
    }

    pub fn network(&self) -> Network {
        self.network
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    // ---- Introspection -------------------------------------------------

    pub async fn health(&self) -> Result<Health> {
        self.request_json(Method::GET, "/v1/health", None::<&()>, None)
            .await
    }

    pub async fn network_info(&self) -> Result<NetworkInfo> {
        self.request_json(Method::GET, "/v1/network", None::<&()>, None)
            .await
    }

    /// Protocol public parameters bytes for a curve. Hits the
    /// per-instance cache first; on miss, fetches `/v1/protocol-parameters`
    /// and base64-decodes the body.
    ///
    /// Backend serves these from a boot-warmed LRU keyed on
    /// `(curve, networkEncryptionKeyId)`. Going through us is ~100 ms hot
    /// vs ~11 s of upstream Sui RPC time without the backend cache, so
    /// this is the path the high-level ceremonies should always use.
    /// Long-lived clients should call
    /// [`Self::invalidate_protocol_parameters_cache`] when the backend
    /// signals a network reconfiguration.
    pub async fn protocol_parameters(&self, curve: Curve) -> Result<Vec<u8>> {
        if let Some(cached) = self.protocol_parameters_cache.read().await.get(&curve) {
            return Ok(cached.clone());
        }
        let path = format!("/v1/protocol-parameters?curve={}", curve.as_u8());
        let res: ProtocolParametersResponse = self
            .request_json(Method::GET, &path, None::<&()>, None)
            .await?;
        let bytes = BASE64.decode(res.bytes_base64.as_bytes()).map_err(|e| {
            MpcKitError::Invalid(format!("invalid base64 in protocol-parameters: {e}"))
        })?;
        self.protocol_parameters_cache
            .write()
            .await
            .insert(curve, bytes.clone());
        Ok(bytes)
    }

    /// Drop the per-instance protocol-parameters cache. Use after the
    /// backend signals a network reconfiguration so the next call
    /// re-fetches.
    pub async fn invalidate_protocol_parameters_cache(&self) {
        self.protocol_parameters_cache.write().await.clear();
    }

    // ---- Billing -------------------------------------------------------

    pub async fn billing_pricing(&self) -> Result<BillingPricing> {
        self.request_json(Method::GET, "/v1/billing/pricing", None::<&()>, None)
            .await
    }

    pub async fn deposit_address(&self) -> Result<DepositAddress> {
        self.request_json(Method::GET, "/v1/billing/address", None::<&()>, None)
            .await
    }

    pub async fn balance(&self) -> Result<Balance> {
        self.request_json(Method::GET, "/v1/billing/balance", None::<&()>, None)
            .await
    }

    pub async fn declare_deposit(&self, tx_digest: &str) -> Result<DepositDeclareResponse> {
        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(rename = "txDigest")]
            tx_digest: &'a str,
        }
        self.request_json(
            Method::POST,
            "/v1/billing/deposit",
            Some(&Body { tx_digest }),
            None,
        )
        .await
    }

    pub async fn billing_history(&self) -> Result<BillingHistory> {
        self.request_json(Method::GET, "/v1/billing/history", None::<&()>, None)
            .await
    }

    // ---- Encryption keys -----------------------------------------------

    pub async fn register_encryption_key<'a>(
        &self,
        body: &EncryptionKeyCreate<'a>,
    ) -> Result<EncryptionKey> {
        self.request_json(Method::POST, "/v1/encryption-keys", Some(body), None)
            .await
    }

    // ---- DWallets ------------------------------------------------------

    pub async fn list_dwallets(&self) -> Result<DwalletList> {
        self.request_json(Method::GET, "/v1/dwallets", None::<&()>, None)
            .await
    }

    pub async fn get_dwallet(&self, dwallet_id: &str) -> Result<DWalletResponse> {
        let path = format!("/v1/dwallets/{}", urlencoding(dwallet_id));
        self.request_json(Method::GET, &path, None::<&()>, None)
            .await
    }

    pub async fn onboard_zero_trust<'a>(
        &self,
        body: &OnboardZeroTrustRequest<'a>,
    ) -> Result<OnboardZeroTrustResponse> {
        self.request_json(Method::POST, "/v1/dwallets", Some(body), None)
            .await
    }

    pub async fn accept_user_share(
        &self,
        dwallet_id: &str,
        encrypted_user_secret_key_share_id: &str,
        user_output_signature_hex: &str,
    ) -> Result<AcceptDWalletResponse> {
        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(rename = "encryptedUserSecretKeyShareId")]
            encrypted_user_secret_key_share_id: &'a str,
            #[serde(rename = "userOutputSignatureHex")]
            user_output_signature_hex: &'a str,
        }
        let path = format!("/v1/dwallets/{}/accept", urlencoding(dwallet_id));
        self.request_json(
            Method::POST,
            &path,
            Some(&Body {
                encrypted_user_secret_key_share_id,
                user_output_signature_hex,
            }),
            None,
        )
        .await
    }

    // ---- Sign (two-phase) ---------------------------------------------

    /// Phase 1: reserve a presign + return its bytes. The caller signs
    /// over those bytes locally to produce the centralized message
    /// signature for [`Self::sign_submit`]. `idempotency_key` MUST be
    /// stable across retries so duplicates are read-only.
    pub async fn sign_prepare<'a>(
        &self,
        idempotency_key: &str,
        body: &SignPrepareRequest<'a>,
    ) -> Result<SignPrepareResponse> {
        self.request_json(Method::POST, "/v1/sign", Some(body), Some(idempotency_key))
            .await
    }

    /// Phase 2: submit the centralized signature; the worker drives
    /// the on-chain PTB asynchronously. Poll [`Self::get_sign_request`]
    /// until `status` is `completed` or `failed`.
    pub async fn sign_submit<'a>(
        &self,
        sign_request_id: &str,
        body: &SignSubmitRequest<'a>,
    ) -> Result<SignSubmitResponse> {
        let path = format!("/v1/sign/{}/submit", urlencoding(sign_request_id),);
        self.request_json(Method::POST, &path, Some(body), None)
            .await
    }

    pub async fn get_sign_request(&self, sign_request_id: &str) -> Result<SignRequest> {
        let path = format!("/v1/sign/{}", urlencoding(sign_request_id));
        let res: SignRequestEnvelope = self
            .request_json(Method::GET, &path, None::<&()>, None)
            .await?;
        Ok(res.sign_request)
    }

    /// Pull the on-chain dwallet's public output (proxied through the
    /// backend so we don't need a local Sui gRPC client). `status`
    /// is one of `"awaiting_user_share"` or `"active"`. Polls until
    /// the network reaches the requested state or `timeout_ms` is
    /// exceeded.
    pub async fn dwallet_onchain_state(
        &self,
        dwallet_id: &str,
        status: &str,
        timeout_ms: u64,
    ) -> Result<crate::types::DWalletOnchainState> {
        let path = format!(
            "/v1/dwallets/{}/onchain-state?status={}&timeoutMs={}",
            urlencoding(dwallet_id),
            status,
            timeout_ms,
        );
        self.request_json(Method::GET, &path, None::<&()>, None)
            .await
    }

    // ---- High-level ceremonies (crypto feature) ------------------------

    /// Drive the full zero-trust DKG + accept ceremony end-to-end.
    /// Mirrors the TS SDK's `MpcKit.onboard()`: derives keys from the
    /// seed, registers the encryption key, runs the local DKG step,
    /// submits the on-chain dwallet, polls the SDK-side
    /// `getDWallet` endpoint until the network finalises the dwallet's
    /// public output, signs it locally, and accepts the user share.
    /// Returns the user secret key share — the caller MUST persist it
    /// alongside the dwallet id; the backend never sees it.
    #[cfg(feature = "crypto")]
    pub async fn onboard(&self, args: OnboardArgs<'_>) -> Result<OnboardResult> {
        use crate::crypto::{prepare_dkg, UserShareEncryptionKeys};
        use crate::types::{EncryptionKeyCreate, OnboardZeroTrustRequest};

        let keys = UserShareEncryptionKeys::from_root_seed_key(args.seed, args.curve)?;
        let signing_pub_hex = hex::encode(keys.signing_public_key_bytes());

        // 1. Register encryption key (idempotent on user + curve + signerPub).
        let enc_sig_hex = hex::encode(keys.sign_encryption_key());
        let encryption_key = self
            .register_encryption_key(&EncryptionKeyCreate {
                curve: args.curve.as_u8(),
                encryption_key_hex: &hex::encode(&keys.encryption_key),
                encryption_key_signature_hex: &enc_sig_hex,
                signer_public_key_hex: &signing_pub_hex,
            })
            .await?;

        // 2. Pull operator address + protocol params from backend in parallel.
        let (network, protocol_pp) =
            tokio::try_join!(self.network_info(), self.protocol_parameters(args.curve),)?;

        // 3. WASM-equivalent DKG locally (uses the backend's pp bytes).
        let session_id_random = random_bytes_32();
        let dkg = prepare_dkg(
            &keys,
            &protocol_pp,
            &session_id_random,
            &network.operator_address,
        )?;

        // 4. Submit the DKG PTB through the backend.
        let onboard_resp = self
            .onboard_zero_trust(&OnboardZeroTrustRequest {
                encryption_key_id: &encryption_key.id,
                dwallet_network_encryption_key_id: &network.latest_encryption_key.id,
                centralized_public_key_share_and_proof_hex: &hex::encode(&dkg.user_dkg_message),
                encrypted_centralized_secret_share_and_proof_hex: &hex::encode(
                    &dkg.encrypted_user_share_and_proof,
                ),
                user_public_output_hex: &hex::encode(&dkg.user_public_output),
                signer_public_key_hex: &signing_pub_hex,
                session_identifier_hex: &hex::encode(&session_id_random),
            })
            .await?;

        // 5. Wait for the dwallet to advance to AwaitingKeyHolderSignature
        //    and pull its on-chain public output. We poll the backend's
        //    `/v1/dwallets/:id` endpoint instead of round-tripping
        //    through Sui gRPC directly — backend already does the
        //    upstream poll under the hood.
        let timeout = args.timeout.unwrap_or(std::time::Duration::from_secs(600));
        let interval = std::time::Duration::from_secs(2);
        let dwallet_public_output = self
            .poll_dwallet_for_state(
                &onboard_resp.dwallet.id,
                "awaiting_user_share",
                timeout,
                interval,
            )
            .await?;

        // 6. Sign the (dwallet || user) public output and accept.
        let user_out_sig = keys.sign_user_output(&dwallet_public_output, &dkg.user_public_output);
        let accept = self
            .accept_user_share(
                &onboard_resp.dwallet.id,
                &onboard_resp.encrypted_user_secret_key_share_id,
                &hex::encode(user_out_sig),
            )
            .await?;

        Ok(OnboardResult {
            dwallet: accept.dwallet,
            encryption_key,
            encrypted_user_secret_key_share_id: onboard_resp.encrypted_user_secret_key_share_id,
            user_secret_key_share_hex: hex::encode(&dkg.user_secret_key_share),
            user_public_output_hex: hex::encode(&dkg.user_public_output),
        })
    }

    /// Drive the two-phase sign ceremony end-to-end. Mirrors the TS
    /// SDK's `MpcKit.sign()`: reserves a presign, computes the
    /// centralized signature locally over the dwallet's *active*
    /// public output, submits phase 2, and polls until completion.
    #[cfg(feature = "crypto")]
    pub async fn sign(&self, args: SignArgs<'_>) -> Result<SignResult> {
        use crate::crypto::{centralized_sign, relative_sig_and_hash};
        use crate::types::{SignPrepareRequest, SignSubmitRequest};

        // The signer's seed is consumed implicitly via the
        // `user_secret_key_share_hex` (computed during onboard); we
        // don't need to re-derive `UserShareEncryptionKeys` here.
        let _ = args.seed;

        // Sign-prepare body uses the chain-relative `(sig, hash)`
        // numbers the Move coordinator validates. Compute once and
        // share with the centralized-sign call below.
        let (rel_sig, rel_hash) =
            relative_sig_and_hash(args.curve, args.signature_algorithm, args.hash_scheme)?;

        // Phase 1: reserve a presign.
        let idempotency_key = args
            .idempotency_key
            .map(str::to_owned)
            .unwrap_or_else(new_idempotency_key);
        let prepared = self
            .sign_prepare(
                &idempotency_key,
                &SignPrepareRequest {
                    dwallet_id: args.dwallet_id,
                    signature_algorithm: rel_sig,
                    hash_scheme: rel_hash,
                    message_hex: &hex::encode(args.message),
                },
            )
            .await?;

        // Need the dwallet's *active* public output (network-finalised).
        // Pull it through the backend + protocol params in parallel.
        let active_timeout = args.timeout.unwrap_or(std::time::Duration::from_secs(60));
        let interval = std::time::Duration::from_secs(1);
        let (dwallet_public_output, protocol_pp) = tokio::try_join!(
            self.poll_dwallet_for_state(args.dwallet_id, "active", active_timeout, interval),
            self.protocol_parameters(args.curve),
        )?;

        // Phase 1.5: WASM-equivalent centralized signature.
        let presign_bytes = hex::decode(&prepared.presign_bytes_hex)
            .map_err(|e| MpcKitError::Invalid(format!("invalid presign hex from backend: {e}")))?;
        let user_secret = hex::decode(args.user_secret_key_share_hex)
            .map_err(|e| MpcKitError::Invalid(format!("invalid user_secret_key_share_hex: {e}")))?;
        let centralized_sig = centralized_sign(
            &protocol_pp,
            &dwallet_public_output,
            &user_secret,
            &presign_bytes,
            args.message,
            args.curve,
            args.signature_algorithm,
            args.hash_scheme,
        )?;

        // Phase 2: submit.
        let session_id_random = random_bytes_32();
        self.sign_submit(
            &prepared.sign_request.id,
            &SignSubmitRequest {
                message_centralized_signature_hex: &hex::encode(&centralized_sig),
                session_identifier_hex: &hex::encode(&session_id_random),
            },
        )
        .await?;

        // Poll until completed.
        let total_timeout = args.timeout.unwrap_or(std::time::Duration::from_secs(180));
        let final_req = self
            .poll_sign_until_terminal(
                &prepared.sign_request.id,
                total_timeout,
                std::time::Duration::from_millis(1500),
            )
            .await?;
        let signature_hex = final_req.signature_hex.clone().ok_or_else(|| {
            MpcKitError::Invalid("sign completed but signature_hex is null".into())
        })?;
        let signature = hex::decode(&signature_hex)
            .map_err(|e| MpcKitError::Invalid(format!("invalid signature hex: {e}")))?;
        Ok(SignResult {
            signature,
            sign_request_id: final_req.id.clone(),
            sign_session_id: final_req.sign_session_id.clone(),
            tx_digest: final_req.tx_digest.clone(),
        })
    }

    #[cfg(feature = "crypto")]
    async fn poll_dwallet_for_state(
        &self,
        dwallet_id: &str,
        status: &str,
        timeout: std::time::Duration,
        _interval: std::time::Duration,
    ) -> Result<Vec<u8>> {
        // Backend's /onchain-state endpoint already polls upstream Sui
        // gRPC; we just hand it the timeout in ms.
        let timeout_ms = timeout.as_millis().min(u64::MAX as u128) as u64;
        let state = self
            .dwallet_onchain_state(dwallet_id, status, timeout_ms)
            .await?;
        let stripped = state
            .public_output_hex
            .strip_prefix("0x")
            .unwrap_or(&state.public_output_hex);
        hex::decode(stripped).map_err(|e| {
            MpcKitError::Invalid(format!("invalid public_output hex from backend: {e}"))
        })
    }

    #[cfg(feature = "crypto")]
    async fn poll_sign_until_terminal(
        &self,
        sign_request_id: &str,
        timeout: std::time::Duration,
        interval: std::time::Duration,
    ) -> Result<SignRequest> {
        let deadline = std::time::Instant::now() + timeout;
        use crate::types::SignRequestStatus;
        loop {
            let req = self.get_sign_request(sign_request_id).await?;
            match req.status {
                SignRequestStatus::Completed => return Ok(req),
                SignRequestStatus::Failed => {
                    return Err(MpcKitError::Http {
                        status: 422,
                        code: req
                            .error_code
                            .clone()
                            .unwrap_or_else(|| "SIGN_FAILED".into()),
                        message: req
                            .error_message
                            .clone()
                            .unwrap_or_else(|| "sign failed".into()),
                        body: serde_json::Value::Null,
                    });
                }
                _ => {}
            }
            if std::time::Instant::now() >= deadline {
                return Err(MpcKitError::Timeout(format!(
                    "sign {sign_request_id} did not terminate within {}ms",
                    timeout.as_millis()
                )));
            }
            tokio::time::sleep(interval).await;
        }
    }

    // ---- Internal ------------------------------------------------------

    async fn request_json<B, R>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
        idempotency_key: Option<&str>,
    ) -> Result<R>
    where
        B: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        let url = self.base_url.join(path)?;
        let mut req = self.inner.request(method, url);
        if let Some(idem) = idempotency_key {
            req = req.header("idempotency-key", idem);
        }
        if let Some(body) = body {
            req = req.json(body);
        }
        let res = req.send().await?;
        let status = res.status();
        let bytes = res.bytes().await?;
        if status.is_success() {
            return serde_json::from_slice(&bytes).map_err(MpcKitError::from);
        }
        Err(error_from_response(status, &bytes))
    }
}

#[derive(Debug, serde::Deserialize)]
struct SignRequestEnvelope {
    #[serde(rename = "signRequest")]
    sign_request: SignRequest,
}

#[derive(Debug, serde::Deserialize)]
pub struct Balance {
    /// microUSD balance (1 microUSD = $0.000001).
    #[serde(rename = "creditsMicro")]
    pub credits_micro: String,
    /// Same as `credits_micro` rendered as a USD string.
    #[serde(rename = "creditsUsd")]
    pub credits_usd: String,
}

fn error_from_response(status: StatusCode, bytes: &[u8]) -> MpcKitError {
    let body: serde_json::Value = serde_json::from_slice(bytes).unwrap_or(serde_json::Value::Null);
    let code = body
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN_ERROR")
        .to_owned();
    let message = body
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("request failed")
        .to_owned();
    if status.as_u16() == 402 {
        return MpcKitError::InsufficientCredits { message, body };
    }
    MpcKitError::Http {
        status: status.as_u16(),
        code,
        message,
        body,
    }
}

fn urlencoding(s: &str) -> String {
    // Path segments only allow a small set; the ids we care about
    // (uuids + 0x-hex) don't need escaping, but we still percent-encode
    // defensively in case future ids include `/` or `#`.
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        let c = *byte;
        let safe = c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.' | b'_' | b'~');
        if safe {
            out.push(c as char);
        } else {
            out.push_str(&format!("%{:02X}", c));
        }
    }
    out
}

/// Builder for [`MpcKit`].
#[derive(Default, Debug, Clone)]
pub struct MpcKitBuilder {
    base_url: Option<String>,
    api_key: Option<String>,
    network: Option<Network>,
    timeout: Option<Duration>,
    user_agent: Option<String>,
}

impl MpcKitBuilder {
    pub fn base_url<S: Into<String>>(mut self, base_url: S) -> Self {
        self.base_url = Some(base_url.into());
        self
    }

    pub fn api_key<S: Into<String>>(mut self, api_key: S) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    pub fn network(mut self, network: Network) -> Self {
        self.network = Some(network);
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    pub fn user_agent<S: Into<String>>(mut self, user_agent: S) -> Self {
        self.user_agent = Some(user_agent.into());
        self
    }

    pub fn build(self) -> Result<MpcKit> {
        let api_key = self
            .api_key
            .ok_or_else(|| MpcKitError::Invalid("api_key is required".into()))?;
        let network = self
            .network
            .ok_or_else(|| MpcKitError::Invalid("network is required".into()))?;
        // Default to the hosted MpcKit endpoint for the chosen network;
        // self-hosting / dev callers can pass `.base_url(...)` to override.
        let raw_base = self
            .base_url
            .unwrap_or_else(|| network.default_base_url().to_owned());

        // Trailing slash matters for `Url::join`; without it the last
        // path segment gets replaced instead of appended.
        let normalised = if raw_base.ends_with('/') {
            raw_base
        } else {
            format!("{raw_base}/")
        };
        let base_url = Url::parse(&normalised)?;

        let mut headers = HeaderMap::new();
        let bearer = format!("Bearer {api_key}");
        let mut bearer_value = HeaderValue::from_str(&bearer)
            .map_err(|e| MpcKitError::Invalid(format!("invalid api_key: {e}")))?;
        bearer_value.set_sensitive(true);
        headers.insert(AUTHORIZATION, bearer_value);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let user_agent = self
            .user_agent
            .unwrap_or_else(|| format!("mpckit-rust/{}", env!("CARGO_PKG_VERSION")));

        let inner = Client::builder()
            .default_headers(headers)
            .user_agent(user_agent)
            .timeout(self.timeout.unwrap_or(DEFAULT_TIMEOUT))
            .build()
            .map_err(MpcKitError::Transport)?;

        Ok(MpcKit {
            inner,
            base_url,
            network,
            protocol_parameters_cache: Arc::new(RwLock::new(HashMap::new())),
        })
    }
}

/// Generate a fresh idempotency key. Use the same key on retries so
/// the backend deduplicates phase-1 sign reservations. The format is
/// a UUIDv4; any string in the 8..200 char range works.
pub fn new_idempotency_key() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(feature = "crypto")]
fn random_bytes_32() -> Vec<u8> {
    // UUIDv4 gives us 16 bytes of crypto-strong randomness; concatenate
    // two for a 32-byte preimage. Avoids pulling in the full `rand`
    // crate just for this.
    let mut out = Vec::with_capacity(32);
    out.extend_from_slice(Uuid::new_v4().as_bytes());
    out.extend_from_slice(Uuid::new_v4().as_bytes());
    out
}

/// Inputs to [`MpcKit::onboard`]. The `seed` is the user's root secret
/// (e.g. derived from a passkey PRF or env-stored secret); never sent
/// to the backend.
#[cfg(feature = "crypto")]
pub struct OnboardArgs<'a> {
    pub seed: &'a [u8; 32],
    pub curve: crate::constants::Curve,
    /// Cap the wait for the dwallet to reach AwaitingKeyHolderSignature.
    /// Defaults to 10 minutes if `None`.
    pub timeout: Option<std::time::Duration>,
}

#[cfg(feature = "crypto")]
pub struct OnboardResult {
    pub dwallet: crate::types::DWallet,
    pub encryption_key: crate::types::EncryptionKey,
    pub encrypted_user_secret_key_share_id: String,
    /// Local-only — persist alongside the dwallet to be able to sign.
    pub user_secret_key_share_hex: String,
    pub user_public_output_hex: String,
}

/// Inputs to [`MpcKit::sign`]. The `user_secret_key_share_hex` is the
/// value returned by a prior `onboard()` call; persist it locally —
/// the backend never has it.
#[cfg(feature = "crypto")]
pub struct SignArgs<'a> {
    pub seed: &'a [u8; 32],
    pub dwallet_id: &'a str,
    pub curve: crate::constants::Curve,
    pub signature_algorithm: crate::constants::SignatureAlgorithm,
    pub hash_scheme: crate::constants::Hash,
    pub message: &'a [u8],
    pub user_secret_key_share_hex: &'a str,
    /// Stable across retries. Auto-generated if `None`.
    pub idempotency_key: Option<&'a str>,
    /// End-to-end timeout. Defaults to 3 minutes if `None`.
    pub timeout: Option<std::time::Duration>,
}

#[cfg(feature = "crypto")]
pub struct SignResult {
    pub signature: Vec<u8>,
    pub sign_request_id: String,
    pub sign_session_id: Option<String>,
    pub tx_digest: Option<String>,
}
