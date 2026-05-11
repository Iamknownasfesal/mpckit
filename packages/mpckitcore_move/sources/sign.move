/// Sign entrypoints for mpckitcore accounts.
///
/// Three flavours, gated differently:
///
///   `request_sign_zero_trust`: zero-trust dWallets. The user produced
///     the centralized message client-side using their share; that's
///     the cryptographic auth. Move-level gate is just dWallet
///     membership. Coordinator's WASM verifies the centralized signature
///     against the dWallet's public output.
///
///   `request_sign_shared`: shared dWallets. There's no user-side
///     share, so the only auth is M-of-N over the per-dWallet roster.
///     Challenge binds dWallet wrapper UID, message, hash scheme, and
///     signature algorithm.
///
///   `request_future_sign` + `complete_future_sign`: two-phase signing.
///     Phase 1 commits a centralized message + presign as a partial
///     signature cap; phase 2 consumes it once approval is collected
///     out-of-band. Both phases gated by M-of-N over the shared dWallet's
///     roster, so the governance window is enforced on chain.
module mpckitcore::sign;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{
        UnverifiedPartialUserSignatureCap,
        UnverifiedPresignCap,
        VerifiedPartialUserSignatureCap
    }
};
use mpckitcore::{account::Account, auth::Credential, challenges};
use std::{bcs, hash};
use sui::{coin::Coin, event, sui::SUI};

const EDWalletNotInAccount: u64 = 1;

/// Emitted by every successful sign-request entrypoint. Off-chain
/// workers parse this to locate the coordinator session id (sign_id)
/// they should poll for the completed signature.
public struct SignRequested has copy, drop {
    sign_id: ID,
    dwallet_id: ID,
    signature_algorithm: u32,
    hash_scheme: u32,
}

// ===== Zero-trust sign =====

public fun request_sign_zero_trust(
    account: &mut Account,
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    presign_cap: UnverifiedPresignCap,
    signature_algorithm: u32,
    hash_scheme: u32,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    session_identifier_bytes: vector<u8>,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    ctx: &mut TxContext,
): ID {
    assert!(account.has_dwallet(dwallet_id), EDWalletNotInAccount);
    let verified = coordinator.verify_presign_cap(presign_cap, ctx);
    let approval = coordinator.approve_message(
        account.dwallet_cap(dwallet_id),
        signature_algorithm,
        hash_scheme,
        message,
    );
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);
    let sign_id = coordinator.request_sign_and_return_id(
        verified,
        approval,
        message_centralized_signature,
        session,
        payment_ika,
        payment_sui,
        ctx,
    );
    event::emit(SignRequested {
        sign_id,
        dwallet_id,
        signature_algorithm,
        hash_scheme,
    });
    sign_id
}

// ===== Shared sign =====

public fun request_sign_shared(
    account: &mut Account,
    signing_credentials: vector<Credential>,
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    presign_cap: UnverifiedPresignCap,
    signature_algorithm: u32,
    hash_scheme: u32,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    session_identifier_bytes: vector<u8>,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    ctx: &mut TxContext,
): ID {
    assert!(account.has_shared_dwallet(dwallet_id), EDWalletNotInAccount);
    let payload = sign_payload_digest(signature_algorithm, hash_scheme, &message);
    let stored_uid = account.stored_shared_uid_bytes(dwallet_id);
    let nonce = account.stored_shared_nonce(dwallet_id);
    let challenge = challenges::request_sign(&stored_uid, nonce, &payload);
    account.authorize_shared_and_bump_nonce(
        dwallet_id,
        signing_credentials,
        &challenge,
        ctx,
    );

    let verified = coordinator.verify_presign_cap(presign_cap, ctx);
    let approval = coordinator.approve_message(
        account.shared_dwallet_cap(dwallet_id),
        signature_algorithm,
        hash_scheme,
        message,
    );
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);
    coordinator.request_sign_and_return_id(
        verified,
        approval,
        message_centralized_signature,
        session,
        payment_ika,
        payment_sui,
        ctx,
    )
}

// ===== Future sign (two-phase, shared dWallets only) =====

public fun request_future_sign(
    account: &mut Account,
    signing_credentials: vector<Credential>,
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    presign_cap: UnverifiedPresignCap,
    hash_scheme: u32,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    session_identifier_bytes: vector<u8>,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    ctx: &mut TxContext,
): UnverifiedPartialUserSignatureCap {
    assert!(account.has_shared_dwallet(dwallet_id), EDWalletNotInAccount);
    let payload = future_sign_payload_digest(hash_scheme, &message);
    let stored_uid = account.stored_shared_uid_bytes(dwallet_id);
    let nonce = account.stored_shared_nonce(dwallet_id);
    let challenge = challenges::request_future_sign(&stored_uid, nonce, &payload);
    account.authorize_shared_and_bump_nonce(
        dwallet_id,
        signing_credentials,
        &challenge,
        ctx,
    );

    let verified = coordinator.verify_presign_cap(presign_cap, ctx);
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);
    coordinator.request_future_sign(
        dwallet_id,
        verified,
        message,
        hash_scheme,
        message_centralized_signature,
        session,
        payment_ika,
        payment_sui,
        ctx,
    )
}

public fun verify_partial_user_signature_cap(
    coordinator: &mut DWalletCoordinator,
    cap: UnverifiedPartialUserSignatureCap,
    ctx: &mut TxContext,
): VerifiedPartialUserSignatureCap {
    coordinator.verify_partial_user_signature_cap(cap, ctx)
}

public fun complete_future_sign(
    account: &mut Account,
    signing_credentials: vector<Credential>,
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    partial_cap: VerifiedPartialUserSignatureCap,
    signature_algorithm: u32,
    hash_scheme: u32,
    message: vector<u8>,
    session_identifier_bytes: vector<u8>,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    ctx: &mut TxContext,
): ID {
    assert!(account.has_shared_dwallet(dwallet_id), EDWalletNotInAccount);
    let payload = sign_payload_digest(signature_algorithm, hash_scheme, &message);
    let stored_uid = account.stored_shared_uid_bytes(dwallet_id);
    let nonce = account.stored_shared_nonce(dwallet_id);
    let challenge = challenges::complete_future_sign(&stored_uid, nonce, &payload);
    account.authorize_shared_and_bump_nonce(
        dwallet_id,
        signing_credentials,
        &challenge,
        ctx,
    );

    let approval = coordinator.approve_message(
        account.shared_dwallet_cap(dwallet_id),
        signature_algorithm,
        hash_scheme,
        message,
    );
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);
    coordinator.request_sign_with_partial_user_signature_and_return_id(
        partial_cap,
        approval,
        session,
        payment_ika,
        payment_sui,
        ctx,
    )
}

// ===== Helpers =====

fun sign_payload_digest(
    signature_algorithm: u32,
    hash_scheme: u32,
    message: &vector<u8>,
): vector<u8> {
    let mut buf = vector::empty<u8>();
    buf.append(bcs::to_bytes(&signature_algorithm));
    buf.append(bcs::to_bytes(&hash_scheme));
    buf.append(bcs::to_bytes(message));
    hash::sha2_256(buf)
}

fun future_sign_payload_digest(hash_scheme: u32, message: &vector<u8>): vector<u8> {
    let mut buf = vector::empty<u8>();
    buf.append(bcs::to_bytes(&hash_scheme));
    buf.append(bcs::to_bytes(message));
    hash::sha2_256(buf)
}
