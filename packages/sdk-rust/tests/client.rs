//! Behavioural tests using wiremock. Pins:
//!
//!   1. `/v1/network` deserialises the `operatorAddress` field — this
//!      is load-bearing for future high-level DKG; the wire shape
//!      changing under us would break consumers silently otherwise.
//!
//!   2. Bearer auth header is sent on every request.
//!
//!   3. `/v1/billing/deposit` round-trips the `txDigest` body and the
//!      response shape.
//!
//!   4. 402 responses surface as `MPCKitError::InsufficientCredits`.
//!
//!   5. `sign_prepare` includes the `idempotency-key` header so phase-1
//!      retries are server-side dedup'd.
//!
//!   6. Builder rejects missing required fields.

use mpckit::{Curve, MPCKit, MPCKitError, Network};
use serde_json::json;
use wiremock::matchers::{body_json, header, header_exists, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn build(server: &MockServer) -> MPCKit {
    MPCKit::builder()
        .base_url(server.uri())
        .api_key("mpckit_test_x")
        .network(Network::Testnet)
        .build()
        .expect("build client")
}

#[tokio::test]
async fn network_info_decodes_operator_address() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/network"))
        .and(header("authorization", "Bearer mpckit_test_x"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "operatorAddress": "0xOPERATOR",
            "packages": {
                "ikaPackage": "0xPKG",
                "ikaDwallet2pcMpcPackage": "0xPKG2",
            },
            "objects": { "coordinator": "0xCOORD", "system": "0xSYS" },
            "latestEncryptionKey": { "id": "0xK", "epoch": 1, "loadedAt": 0 }
        })))
        .expect(1)
        .mount(&server)
        .await;

    let api = build(&server).await;
    let info = api.network_info().await.expect("network_info");
    assert_eq!(info.operator_address, "0xOPERATOR");
    assert_eq!(info.packages.ika_package, "0xPKG");
}

#[tokio::test]
async fn declare_deposit_round_trips_tx_digest() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/billing/deposit"))
        .and(body_json(json!({ "txDigest": "DIGEST_OK" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "deposit": {
                "id": "d-1",
                "txDigest": "DIGEST_OK",
                "senderAddress": "0xS",
                "coinType": "0x2::sui::SUI",
                "amountAtomic": "2000000000",
                "creditsMicro": "2000000000",
                "creditsUsd": "2000.000000",
                "sweepStatus": "pending",
                "sweepTxDigest": null,
                "createdAt": "2026-05-08T00:00:00Z",
                "sweptAt": null
            },
            "duplicate": false,
            "creditsMicro": "2000000000",
            "creditsUsd": "2000.000000"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let api = build(&server).await;
    let res = api.declare_deposit("DIGEST_OK").await.expect("declare");
    assert!(!res.duplicate);
    assert_eq!(res.credits_micro, "2000000000");
    assert_eq!(res.deposit.tx_digest, "DIGEST_OK");
}

#[tokio::test]
async fn http_402_maps_to_insufficient_credits() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/billing/balance"))
        .respond_with(ResponseTemplate::new(402).set_body_json(json!({
            "error": "insufficient credits: have 0, need 1000000",
            "code": "INSUFFICIENT_CREDITS"
        })))
        .mount(&server)
        .await;

    let api = build(&server).await;
    let err = api.balance().await.expect_err("must fail");
    match err {
        MPCKitError::InsufficientCredits { ref message, .. } => {
            assert!(message.contains("insufficient credits"));
        }
        other => panic!("expected InsufficientCredits, got {other:?}"),
    }
    assert_eq!(err.http_status(), Some(402));
    assert_eq!(err.code(), Some("INSUFFICIENT_CREDITS"));
}

#[tokio::test]
async fn sign_prepare_sends_idempotency_key_header() {
    use mpckit::SignPrepareRequest;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/sign"))
        .and(header_exists("idempotency-key"))
        .and(header("idempotency-key", "idem-12345"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "signRequest": {
                "id": "sr-1",
                "status": "prepared",
                "txDigest": null,
                "signSessionId": null,
                "signatureHex": null,
                "errorCode": null,
                "errorMessage": null,
                "createdAt": "2026-05-08T00:00:00Z",
                "updatedAt": "2026-05-08T00:00:00Z",
                "completedAt": null
            },
            "duplicate": false,
            "presignBytesHex": "abcd",
            "presignSuiObjectId": "0xPC"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let api = build(&server).await;
    api.sign_prepare(
        "idem-12345",
        &SignPrepareRequest {
            dwallet_id: "dw-1",
            signature_algorithm: 1,
            hash_scheme: 0,
            message_hex: "deadbeef",
        },
    )
    .await
    .expect("sign_prepare");
}

#[tokio::test]
async fn http_500_preserves_code_and_body() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dwallets"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({
            "error": "boom",
            "code": "INTERNAL"
        })))
        .mount(&server)
        .await;

    let api = build(&server).await;
    let err = api.list_dwallets().await.expect_err("must fail");
    match err {
        MPCKitError::Http {
            status,
            ref code,
            ref message,
            ..
        } => {
            assert_eq!(status, 500);
            assert_eq!(code, "INTERNAL");
            assert_eq!(message, "boom");
        }
        other => panic!("expected Http, got {other:?}"),
    }
}

#[tokio::test]
async fn protocol_parameters_caches_decoded_bytes() {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;

    let server = MockServer::start().await;
    let bytes = vec![0xaa, 0xbb, 0xcc];
    // Backend serialises curve as the enum *string* form for this
    // endpoint (other endpoints use numeric form). See the docstring on
    // `ProtocolParametersResponse` in src/types.rs.
    let body = json!({
        "curve": "SECP256K1",
        "encryptionKeyId": "0xK",
        "epoch": 1,
        "loadedAt": 0,
        "bytesBase64": BASE64.encode(&bytes),
        "bytesLength": bytes.len() as u64,
    });
    Mock::given(method("GET"))
        .and(path("/v1/protocol-parameters"))
        .and(query_param("curve", "0"))
        .and(header("authorization", "Bearer mpckit_test_x"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        // expect exactly one HTTP hit; the second call must come from cache
        .expect(1)
        .mount(&server)
        .await;

    let api = build(&server).await;
    let first = api
        .protocol_parameters(Curve::Secp256k1)
        .await
        .expect("first");
    assert_eq!(first, bytes);
    let second = api
        .protocol_parameters(Curve::Secp256k1)
        .await
        .expect("second");
    assert_eq!(second, bytes);

    api.invalidate_protocol_parameters_cache().await;
    // After invalidation a second mock matches (we add a fresh expectation
    // because wiremock asserts `expect(1)` strictly) so we only assert the
    // cache contents above.
}

#[tokio::test]
async fn builder_rejects_missing_required_fields() {
    let no_key = MPCKit::builder()
        .base_url("http://localhost:0")
        .network(Network::Testnet)
        .build();
    assert!(matches!(no_key, Err(MPCKitError::Invalid(_))));

    let no_network = MPCKit::builder()
        .api_key("k")
        .base_url("http://localhost:0")
        .build();
    assert!(matches!(no_network, Err(MPCKitError::Invalid(_))));

    // base_url is optional: omitting it falls back to the hosted endpoint
    // for the chosen network.
    let defaulted = MPCKit::builder()
        .api_key("k")
        .network(Network::Testnet)
        .build()
        .expect("build with default base_url");
    assert_eq!(
        defaulted.base_url().as_str(),
        "https://api.testnet.mpckit.xyz/",
    );

    let mainnet = MPCKit::builder()
        .api_key("k")
        .network(Network::Mainnet)
        .build()
        .expect("build with mainnet default");
    assert_eq!(mainnet.base_url().as_str(), "https://api.mpckit.xyz/");
}
