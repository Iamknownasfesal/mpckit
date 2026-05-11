/// Imported-key dWallet entrypoints.
///
/// A user has an existing private key (e.g. from a migrated wallet)
/// and wants to put it under ika MPC. The verification step runs the
/// import protocol and returns an `ImportedKeyDWalletCap` that we
/// stash on the account.
///
/// Same threat model as zero-trust: the import message is signed by
/// the user's signer key and the share is encrypted to their encryption
/// key, so the cryptography is the auth. Move-level gate is just
/// `OperatorCap` for anti-spam on storage writes; sign needs only the
/// centralized message.
module mpckitcore::imported_key;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{coordinator::DWalletCoordinator, coordinator_inner::UnverifiedPresignCap};
use mpckitcore::{account::Account, acl::OperatorCap};
use sui::{coin::Coin, sui::SUI};

const EDWalletNotInAccount: u64 = 1;

/// Run imported-key verification and stash the resulting cap.
public fun request_imported_key_dwallet_verification(
    _: &OperatorCap,
    account: &mut Account,
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    curve: u32,
    centralized_party_message: vector<u8>,
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
    let cap = coordinator.request_imported_key_dwallet_verification(
        dwallet_network_encryption_key_id,
        curve,
        centralized_party_message,
        encrypted_centralized_secret_share_and_proof,
        encryption_key_address,
        user_public_output,
        signer_public_key,
        session,
        payment_ika,
        payment_sui,
        ctx,
    );

    let dwallet_id = cap.imported_key_dwallet_id();
    account.store_imported_key_cap(dwallet_id, cap, ctx);
}

/// Sign with an imported-key dWallet. Centralized message is the auth.
public fun request_imported_key_sign(
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
    assert!(account.has_imported_key_dwallet(dwallet_id), EDWalletNotInAccount);
    let verified = coordinator.verify_presign_cap(presign_cap, ctx);
    let approval = coordinator.approve_imported_key_message(
        account.imported_key_cap(dwallet_id),
        signature_algorithm,
        hash_scheme,
        message,
    );
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);
    coordinator.request_imported_key_sign_and_return_id(
        verified,
        approval,
        message_centralized_signature,
        session,
        payment_ika,
        payment_sui,
        ctx,
    )
}
