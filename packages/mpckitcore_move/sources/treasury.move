/// Operator fee treasury.
///
/// **Operators cannot withdraw raw coins from this treasury.** Every
/// protocol op goes through a `pay_*` entry that internally drains the
/// treasury into a coin, hands `&mut` refs to the inner ika call, and
/// deposits whatever remains back atomically. `take` / `give_back` are
/// private, so an operator's PTB never sees a loose `Coin<IKA>` it could
/// re-route — the only thing it can express against the treasury is a
/// call to one of the public `pay_*` entries below.
///
/// Anyone may `deposit_ika` / `deposit_sui` to fund the treasury — the
/// gate is on outflow, not on top-up. `AdminCap` can `drain` for
/// rotation or decommission.
module mpckitcore::treasury;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{coordinator::DWalletCoordinator, coordinator_inner::UnverifiedPresignCap};
use mpckitcore::{account::{Self, Account}, acl::{AdminCap, OperatorCap}, dkg, sign};
use sui::{balance::{Self, Balance}, coin::{Self, Coin}, sui::SUI};

public struct Treasury has key {
    id: UID,
    ika: Balance<IKA>,
    sui: Balance<SUI>,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(Treasury {
        id: object::new(ctx),
        ika: balance::zero<IKA>(),
        sui: balance::zero<SUI>(),
    });
}

// ===== Read =====

public fun ika_value(t: &Treasury): u64 { t.ika.value() }

public fun sui_value(t: &Treasury): u64 { t.sui.value() }

// ===== Deposit (open) =====

public fun deposit_ika(t: &mut Treasury, c: Coin<IKA>) {
    t.ika.join(c.into_balance());
}

public fun deposit_sui(t: &mut Treasury, c: Coin<SUI>) {
    t.sui.join(c.into_balance());
}

// ===== Internal helpers =====

/// Drain every IKA + SUI out as fresh coins. Always called paired with
/// `give_back` in the same Move function — there is no path that emits
/// these coins back to a caller's PTB.
fun take(t: &mut Treasury, ctx: &mut TxContext): (Coin<IKA>, Coin<SUI>) {
    let ika = coin::from_balance(t.ika.withdraw_all(), ctx);
    let sui = coin::from_balance(t.sui.withdraw_all(), ctx);
    (ika, sui)
}

/// Return both coins to the treasury. Pairs with `take`.
fun give_back(t: &mut Treasury, ika: Coin<IKA>, sui: Coin<SUI>) {
    t.ika.join(ika.into_balance());
    t.sui.join(sui.into_balance());
}

// ===== Operator pay_* entries =====
//
// Every op the operator runs goes through one of these. Coins are
// constructed inside Move from the treasury, passed `&mut` to the ika
// call, and reabsorbed before the function returns. There is no public
// path in this module that produces a `Coin<IKA>` the operator's PTB
// can route — `take` / `give_back` are private.

/// Register a new shared `Account` AND run zero-trust DKG inside one
/// PTB. Used for the first dWallet a user creates.
public fun pay_register_and_dkg_zero_trust(
    t: &mut Treasury,
    op_cap: &OperatorCap,
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    curve: u32,
    centralized_public_key_share_and_proof: vector<u8>,
    encrypted_centralized_secret_share_and_proof: vector<u8>,
    encryption_key_address: address,
    user_public_output: vector<u8>,
    signer_public_key: vector<u8>,
    session_identifier_bytes: vector<u8>,
    ctx: &mut TxContext,
) {
    let (mut ika, mut sui) = t.take(ctx);
    let mut account = account::register_account(op_cap, ctx);
    dkg::request_dkg_zero_trust(
        op_cap,
        &mut account,
        coordinator,
        dwallet_network_encryption_key_id,
        curve,
        centralized_public_key_share_and_proof,
        encrypted_centralized_secret_share_and_proof,
        encryption_key_address,
        user_public_output,
        signer_public_key,
        session_identifier_bytes,
        &mut ika,
        &mut sui,
        ctx,
    );
    account::share_account(account);
    t.give_back(ika, sui);
}

/// Zero-trust DKG against an existing shared `Account`. Used for the
/// 2nd+ dWallet a user creates.
public fun pay_dkg_zero_trust(
    t: &mut Treasury,
    op_cap: &OperatorCap,
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
    ctx: &mut TxContext,
) {
    let (mut ika, mut sui) = t.take(ctx);
    dkg::request_dkg_zero_trust(
        op_cap,
        account,
        coordinator,
        dwallet_network_encryption_key_id,
        curve,
        centralized_public_key_share_and_proof,
        encrypted_centralized_secret_share_and_proof,
        encryption_key_address,
        user_public_output,
        signer_public_key,
        session_identifier_bytes,
        &mut ika,
        &mut sui,
        ctx,
    );
    t.give_back(ika, sui);
}

/// Mint one `UnverifiedPresignCap` to `recipient`. The operator's PTB
/// composes multiple calls if it wants a batch.
public fun pay_presign(
    t: &mut Treasury,
    _: &OperatorCap,
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    curve: u32,
    signature_algorithm: u32,
    session_identifier_bytes: vector<u8>,
    recipient: address,
    ctx: &mut TxContext,
) {
    let (mut ika, mut sui) = t.take(ctx);
    let session = coordinator.register_session_identifier(session_identifier_bytes, ctx);
    let cap = coordinator.request_global_presign(
        dwallet_network_encryption_key_id,
        curve,
        signature_algorithm,
        session,
        &mut ika,
        &mut sui,
        ctx,
    );
    transfer::public_transfer(cap, recipient);
    t.give_back(ika, sui);
}

/// Zero-trust sign. Pays fees out of the treasury for one
/// `request_sign_zero_trust`.
public fun pay_sign_zero_trust(
    t: &mut Treasury,
    _: &OperatorCap,
    account: &mut Account,
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    presign_cap: UnverifiedPresignCap,
    signature_algorithm: u32,
    hash_scheme: u32,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    session_identifier_bytes: vector<u8>,
    ctx: &mut TxContext,
): ID {
    let (mut ika, mut sui) = t.take(ctx);
    let sign_id = sign::request_sign_zero_trust(
        account,
        coordinator,
        dwallet_id,
        presign_cap,
        signature_algorithm,
        hash_scheme,
        message,
        message_centralized_signature,
        session_identifier_bytes,
        &mut ika,
        &mut sui,
        ctx,
    );
    t.give_back(ika, sui);
    sign_id
}

// ===== Admin =====

/// Drain everything to the caller's wallet. Use for rotation or
/// decommission; not used on a per-op hot path.
public fun drain(t: &mut Treasury, _: &AdminCap, ctx: &mut TxContext): (Coin<IKA>, Coin<SUI>) {
    let ika = t.ika.withdraw_all().into_coin(ctx);
    let sui = t.sui.withdraw_all().into_coin(ctx);
    (ika, sui)
}
