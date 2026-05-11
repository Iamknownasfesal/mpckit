/// DKG entrypoints for mpckitcore accounts.
///
/// `request_dkg_zero_trust`: zero-trust dWallets. The coordinator ties
///   the share to `encryption_key_address`; only that key holder can
///   later sign. No Move-level credential gate; `OperatorCap` gates the
///   storage write purely as anti-spam.
///
/// `accept_user_share`: completes the zero-trust handshake. Coordinator
///   verifies `user_output_signature` against the dWallet's public output;
///   Move-level gate is just dWallet membership.
///
/// `request_dkg_shared`: shared dWallets. There's no user share to gate
///   sign cryptographically, so the dWallet must be created with an
///   initial M-of-N roster that gates every later op on it. `OperatorCap`
///   gates creation; the supplied roster gates everything afterwards.
///   There is no zero-trust to shared migration: a dWallet commits to
///   its model at creation time.
module mpckitcore::dkg;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::coordinator::DWalletCoordinator;
use mpckitcore::{account::Account, acl::OperatorCap, auth::NewCredential};
use sui::{coin::Coin, sui::SUI};

const EDWalletNotInAccount: u64 = 1;

// ===== Zero-trust =====

public fun request_dkg_zero_trust(
    _: &OperatorCap,
    account: &mut Account,
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    curve: u32,
    centralized_public_key_share_and_proof: vector<u8>,
    encrypted_centralized_secret_share_and_proof: vector<u8>,
    encryption_key_address: address,
    user_public_output: vector<u8>,
    signer_public_key: vector<u8>,
    session_identifier_bytes: vector<u8>,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    ctx: &mut TxContext,
) {
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);

    let (cap, _sign_id_opt) = coordinator.request_dwallet_dkg(
        dwallet_network_encryption_key_id,
        curve,
        centralized_public_key_share_and_proof,
        encrypted_centralized_secret_share_and_proof,
        encryption_key_address,
        user_public_output,
        signer_public_key,
        option::none(),
        session,
        payment_ika,
        payment_sui,
        ctx,
    );

    let dwallet_id = cap.dwallet_id();
    account.store_dwallet_cap(dwallet_id, cap, ctx);
}

public fun accept_user_share(
    account: &mut Account,
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    encrypted_user_secret_key_share_id: ID,
    user_output_signature: vector<u8>,
) {
    assert!(account.has_dwallet(dwallet_id), EDWalletNotInAccount);
    coordinator.accept_encrypted_user_share(
        dwallet_id,
        encrypted_user_secret_key_share_id,
        user_output_signature,
    );
}

// ===== Shared =====

public fun request_dkg_shared(
    _: &OperatorCap,
    account: &mut Account,
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    curve: u32,
    centralized_public_key_share_and_proof: vector<u8>,
    user_public_output: vector<u8>,
    public_user_secret_key_share: vector<u8>,
    initial_credentials: vector<NewCredential>,
    threshold: u64,
    session_identifier_bytes: vector<u8>,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    ctx: &mut TxContext,
) {
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);

    let (cap, _sign_id_opt) = coordinator.request_dwallet_dkg_with_public_user_secret_key_share(
        dwallet_network_encryption_key_id,
        curve,
        centralized_public_key_share_and_proof,
        user_public_output,
        public_user_secret_key_share,
        option::none(),
        session,
        payment_ika,
        payment_sui,
        ctx,
    );

    let dwallet_id = cap.dwallet_id();
    account.store_shared_dwallet_cap(
        dwallet_id,
        cap,
        initial_credentials,
        threshold,
        ctx,
    );
}
