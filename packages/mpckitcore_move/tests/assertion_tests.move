#[test_only]
module mpckitcore::assertion_tests;

use mpckitcore::assertion;

const EAssertionInvalid: u64 = 2;
const EChallengeMismatch: u64 = 3;
const EBadType: u64 = 5;
const EBadOrigin: u64 = 6;

fun challenge_32(): vector<u8> {
    let mut v = vector::empty<u8>();
    let mut i: u64 = 0;
    while (i < 32) {
        v.push_back(0xABu8);
        i = i + 1;
    };
    v
}

/// Compose a clientDataJSON-style buffer with the given type, origin, and
/// challenge fields. The verifier only does substring checks, so field
/// ordering and absence of full JSON escaping is fine.
fun client_data(type_str: vector<u8>, origin: vector<u8>, challenge_b64: vector<u8>): vector<u8> {
    let mut out = vector::empty<u8>();
    out.append(b"{\"type\":\"");
    out.append(type_str);
    out.append(b"\",\"challenge\":\"");
    out.append(challenge_b64);
    out.append(b"\",\"origin\":\"");
    out.append(origin);
    out.append(b"\",\"crossOrigin\":false}");
    out
}

fun expected_challenge_b64(): vector<u8> {
    assertion::base64url_encode_32(&challenge_32())
}

#[test]
fun happy_path_passes_all_json_checks() {
    let ch = challenge_32();
    let body = client_data(
        b"webauthn.get",
        b"https://app.mpckit.xyz",
        expected_challenge_b64(),
    );
    assertion::verify_client_data_json(&body, &ch);
}

#[test]
#[expected_failure(abort_code = EBadType, location = mpckitcore::assertion)]
fun bad_type_aborts() {
    let ch = challenge_32();
    // Forged JSON missing the WebAuthn `type` literal. Origin and challenge
    // are correct so we isolate the EBadType abort path.
    let body = client_data(
        b"webauthn.create",
        b"https://app.mpckit.xyz",
        expected_challenge_b64(),
    );
    assertion::verify_client_data_json(&body, &ch);
}

#[test]
#[expected_failure(abort_code = EBadOrigin, location = mpckitcore::assertion)]
fun bad_origin_aborts() {
    let ch = challenge_32();
    // Forged JSON with the wrong RP origin. Challenge and type are correct so
    // we isolate the EBadOrigin abort path.
    let body = client_data(
        b"webauthn.get",
        b"https://evil.example.com",
        expected_challenge_b64(),
    );
    assertion::verify_client_data_json(&body, &ch);
}

#[test]
#[expected_failure(abort_code = EChallengeMismatch, location = mpckitcore::assertion)]
fun bad_challenge_aborts() {
    let ch = challenge_32();
    // Encode a different challenge (all 0xCD) so the substring won't match.
    let mut other = vector::empty<u8>();
    let mut i: u64 = 0;
    while (i < 32) {
        other.push_back(0xCDu8);
        i = i + 1;
    };
    let other_b64 = assertion::base64url_encode_32(&other);
    let body = client_data(b"webauthn.get", b"https://app.mpckit.xyz", other_b64);
    assertion::verify_client_data_json(&body, &ch);
}

#[test]
#[expected_failure(abort_code = EAssertionInvalid, location = mpckitcore::assertion)]
fun verify_signature_rejects_bogus_signature() {
    // Build an assertion that would pass JSON checks but fails ECDSA verify.
    // 33-byte zero pubkey + zero signature is structurally well-formed but
    // cannot validate, so we hit EAssertionInvalid before the JSON pass.
    let ch = challenge_32();
    let body = client_data(
        b"webauthn.get",
        b"https://app.mpckit.xyz",
        expected_challenge_b64(),
    );
    let mut pk = vector::empty<u8>();
    let mut i: u64 = 0;
    while (i < 33) {
        pk.push_back(0u8);
        i = i + 1;
    };
    let mut sig = vector::empty<u8>();
    i = 0;
    while (i < 64) {
        sig.push_back(0u8);
        i = i + 1;
    };
    let mut auth_data = vector::empty<u8>();
    i = 0;
    while (i < 37) {
        auth_data.push_back(0u8);
        i = i + 1;
    };
    let a = assertion::new(pk, auth_data, body, sig);
    assertion::verify_signature(&a, &ch);
}
