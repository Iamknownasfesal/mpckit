/// mpckitcore `Account`.
///
/// An `Account` is an opaque container for one user's dWallet caps,
/// stored as dynamic object fields off `account.id`. There is no
/// account-level credential roster, no nonce, no threshold; auth
/// happens per-op:
///
///   - **Zero-trust** (`StoredDWallet`) and **imported-key**
///     (`StoredImportedKeyDWallet`) dWallets are gated by ika's
///     centralized-message verification. The coordinator already proves
///     the share holder consented; a second on-chain signature would
///     check the same identity twice.
///
///   - **Shared dWallets** (`StoredSharedDWallet`) have no user share
///     so the only on-chain auth is M-of-N over a per-dWallet credential
///     roster. Each shared dWallet carries its own `credentials`,
///     `threshold`, and `nonce`.
///
/// Storage-mutating ops (register, DKG, import) are gated by
/// `OperatorCap` purely as anti-spam. A malicious caller without the
/// user share can't actually compromise anything cryptographically.
module mpckitcore::account;

use ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap, ImportedKeyDWalletCap};
use mpckitcore::{acl::OperatorCap, auth::{Self, Credential, NewCredential}, challenges};
use sui::{dynamic_object_field as dof, vec_set::{Self, VecSet}};

const MAX_CREDENTIALS: u64 = 16;

const ECredentialAlreadyExists: u64 = 1;
const ETooManyCredentials: u64 = 2;
const ECredentialNotFound: u64 = 3;
const EThresholdInvalid: u64 = 4;
const ERemovalUnderflowsThreshold: u64 = 5;
const EThresholdAboveRoster: u64 = 6;
const EDWalletAlreadyStored: u64 = 7;
const EDWalletNotStored: u64 = 8;
const EEmptyInitialCredentials: u64 = 9;

public struct Account has key {
    id: UID,
}

public struct DWalletKey has copy, drop, store { dwallet_id: ID }
public struct SharedDWalletKey has copy, drop, store { dwallet_id: ID }
public struct ImportedKeyDWalletKey has copy, drop, store { dwallet_id: ID }

public struct StoredDWallet has key, store {
    id: UID,
    cap: DWalletCap,
}

public struct StoredSharedDWallet has key, store {
    id: UID,
    cap: DWalletCap,
    /// Active credentials. Each entry is `[scheme, ...pubkey_or_address]`.
    credentials: VecSet<vector<u8>>,
    /// Required distinct signers per state-changing op.
    threshold: u64,
    /// Per-dWallet nonce; included in every challenge.
    nonce: u64,
}

public struct StoredImportedKeyDWallet has key, store {
    id: UID,
    cap: ImportedKeyDWalletCap,
}

// ===== Read accessors =====

public fun has_dwallet(a: &Account, dwallet_id: ID): bool {
    dof::exists_with_type<DWalletKey, StoredDWallet>(&a.id, DWalletKey { dwallet_id })
}

public fun has_shared_dwallet(a: &Account, dwallet_id: ID): bool {
    dof::exists_with_type<SharedDWalletKey, StoredSharedDWallet>(
        &a.id,
        SharedDWalletKey { dwallet_id },
    )
}

public fun has_imported_key_dwallet(a: &Account, dwallet_id: ID): bool {
    dof::exists_with_type<ImportedKeyDWalletKey, StoredImportedKeyDWallet>(
        &a.id,
        ImportedKeyDWalletKey { dwallet_id },
    )
}

public fun shared_nonce(a: &Account, dwallet_id: ID): u64 {
    a.borrow_shared(dwallet_id).nonce
}

public fun shared_threshold(a: &Account, dwallet_id: ID): u64 {
    a.borrow_shared(dwallet_id).threshold
}

public fun shared_credential_count(a: &Account, dwallet_id: ID): u64 {
    a.borrow_shared(dwallet_id).credentials.length()
}

// ===== Lifecycle =====

/// Create a new opaque `Account`. `OperatorCap` gates registration so the
/// hosted backend (or any self-host operator) can rate-limit creation.
/// Returns an owned `Account`; caller composes DKG / setup in the same
/// PTB and finishes with `share_account`.
public fun register_account(_: &OperatorCap, ctx: &mut TxContext): Account {
    Account { id: object::new(ctx) }
}

/// Make the account globally addressable. After this, every other
/// entrypoint takes `&mut Account` against the shared object.
public fun share_account(account: Account) {
    transfer::share_object(account);
}

// ===== Shared dWallet roster ops (M-of-N gated) =====

public fun add_credential(
    account: &mut Account,
    dwallet_id: ID,
    new_credential: NewCredential,
    signing_credentials: vector<Credential>,
    ctx: &TxContext,
) {
    auth::assert_pubkey_length(&new_credential);
    let stored = account.borrow_shared_mut(dwallet_id);
    assert!(stored.credentials.length() < MAX_CREDENTIALS, ETooManyCredentials);
    assert!(
        !auth::is_already_registered(&new_credential, &stored.credentials),
        ECredentialAlreadyExists,
    );
    let new_id = auth::new_credential_id_bytes(&new_credential);
    let stored_uid = wrapper_uid_bytes(stored);
    let challenge = challenges::add_credential(&stored_uid, stored.nonce, &new_id);
    auth::verify_threshold(
        signing_credentials,
        &stored.credentials,
        &challenge,
        stored.threshold,
        ctx,
    );
    auth::insert_credential(new_credential, &mut stored.credentials);
    stored.nonce = stored.nonce + 1;
}

public fun remove_credential(
    account: &mut Account,
    dwallet_id: ID,
    target_credential_id: vector<u8>,
    signing_credentials: vector<Credential>,
    ctx: &TxContext,
) {
    let stored = account.borrow_shared_mut(dwallet_id);
    assert!(stored.credentials.contains(&target_credential_id), ECredentialNotFound);
    assert!(stored.credentials.length() > stored.threshold, ERemovalUnderflowsThreshold);
    let stored_uid = wrapper_uid_bytes(stored);
    let challenge = challenges::remove_credential(
        &stored_uid,
        stored.nonce,
        &target_credential_id,
    );
    auth::verify_threshold(
        signing_credentials,
        &stored.credentials,
        &challenge,
        stored.threshold,
        ctx,
    );
    auth::remove_credential(target_credential_id, &mut stored.credentials);
    stored.nonce = stored.nonce + 1;
}

public fun set_threshold(
    account: &mut Account,
    dwallet_id: ID,
    new_threshold: u64,
    signing_credentials: vector<Credential>,
    ctx: &TxContext,
) {
    let stored = account.borrow_shared_mut(dwallet_id);
    assert!(new_threshold >= 1, EThresholdInvalid);
    assert!(new_threshold <= stored.credentials.length(), EThresholdAboveRoster);
    let stored_uid = wrapper_uid_bytes(stored);
    let challenge = challenges::set_threshold(&stored_uid, stored.nonce, new_threshold);
    auth::verify_threshold(
        signing_credentials,
        &stored.credentials,
        &challenge,
        stored.threshold,
        ctx,
    );
    stored.threshold = new_threshold;
    stored.nonce = stored.nonce + 1;
}

// ===== Internals exposed to dkg/sign/imported_key =====

/// Verify M-of-N over a shared dWallet's roster for `challenge`, then
/// bump its nonce.
public(package) fun authorize_shared_and_bump_nonce(
    account: &mut Account,
    dwallet_id: ID,
    signing_credentials: vector<Credential>,
    challenge: &vector<u8>,
    ctx: &TxContext,
) {
    let stored = account.borrow_shared_mut(dwallet_id);
    auth::verify_threshold(
        signing_credentials,
        &stored.credentials,
        challenge,
        stored.threshold,
        ctx,
    );
    stored.nonce = stored.nonce + 1;
}

public(package) fun stored_shared_uid_bytes(account: &Account, dwallet_id: ID): vector<u8> {
    wrapper_uid_bytes(account.borrow_shared(dwallet_id))
}

public(package) fun stored_shared_nonce(account: &Account, dwallet_id: ID): u64 {
    account.borrow_shared(dwallet_id).nonce
}

// --- Zero-trust DWalletCap storage ---

public(package) fun store_dwallet_cap(
    account: &mut Account,
    dwallet_id: ID,
    cap: DWalletCap,
    ctx: &mut TxContext,
) {
    let key = DWalletKey { dwallet_id };
    assert!(
        !dof::exists_with_type<DWalletKey, StoredDWallet>(&account.id, key),
        EDWalletAlreadyStored,
    );
    dof::add(&mut account.id, key, StoredDWallet { id: object::new(ctx), cap });
}

public(package) fun dwallet_cap(account: &Account, dwallet_id: ID): &DWalletCap {
    let key = DWalletKey { dwallet_id };
    assert!(dof::exists_with_type<DWalletKey, StoredDWallet>(&account.id, key), EDWalletNotStored);
    let stored: &StoredDWallet = dof::borrow(&account.id, key);
    &stored.cap
}

// --- Shared DWalletCap storage ---

public(package) fun store_shared_dwallet_cap(
    account: &mut Account,
    dwallet_id: ID,
    cap: DWalletCap,
    initial_credentials: vector<NewCredential>,
    threshold: u64,
    ctx: &mut TxContext,
) {
    let key = SharedDWalletKey { dwallet_id };
    assert!(
        !dof::exists_with_type<SharedDWalletKey, StoredSharedDWallet>(&account.id, key),
        EDWalletAlreadyStored,
    );
    let credentials = build_initial_roster(initial_credentials, threshold);
    dof::add(
        &mut account.id,
        key,
        StoredSharedDWallet {
            id: object::new(ctx),
            cap,
            credentials,
            threshold,
            nonce: 0,
        },
    );
}

public(package) fun shared_dwallet_cap(account: &Account, dwallet_id: ID): &DWalletCap {
    &account.borrow_shared(dwallet_id).cap
}

// --- Imported-key DWalletCap storage ---

public(package) fun store_imported_key_cap(
    account: &mut Account,
    dwallet_id: ID,
    cap: ImportedKeyDWalletCap,
    ctx: &mut TxContext,
) {
    let key = ImportedKeyDWalletKey { dwallet_id };
    assert!(
        !dof::exists_with_type<ImportedKeyDWalletKey, StoredImportedKeyDWallet>(
            &account.id,
            key,
        ),
        EDWalletAlreadyStored,
    );
    dof::add(
        &mut account.id,
        key,
        StoredImportedKeyDWallet { id: object::new(ctx), cap },
    );
}

public(package) fun imported_key_cap(account: &Account, dwallet_id: ID): &ImportedKeyDWalletCap {
    let key = ImportedKeyDWalletKey { dwallet_id };
    assert!(
        dof::exists_with_type<ImportedKeyDWalletKey, StoredImportedKeyDWallet>(
            &account.id,
            key,
        ),
        EDWalletNotStored,
    );
    let stored: &StoredImportedKeyDWallet = dof::borrow(&account.id, key);
    &stored.cap
}

// ===== Private helpers =====

fun borrow_shared(account: &Account, dwallet_id: ID): &StoredSharedDWallet {
    let key = SharedDWalletKey { dwallet_id };
    assert!(
        dof::exists_with_type<SharedDWalletKey, StoredSharedDWallet>(&account.id, key),
        EDWalletNotStored,
    );
    dof::borrow(&account.id, key)
}

fun borrow_shared_mut(account: &mut Account, dwallet_id: ID): &mut StoredSharedDWallet {
    let key = SharedDWalletKey { dwallet_id };
    assert!(
        dof::exists_with_type<SharedDWalletKey, StoredSharedDWallet>(&account.id, key),
        EDWalletNotStored,
    );
    dof::borrow_mut(&mut account.id, key)
}

fun wrapper_uid_bytes(s: &StoredSharedDWallet): vector<u8> {
    object::id_address(s).to_bytes()
}

fun build_initial_roster(mut creds: vector<NewCredential>, threshold: u64): VecSet<vector<u8>> {
    let len = creds.length();
    assert!(len > 0, EEmptyInitialCredentials);
    assert!(len <= MAX_CREDENTIALS, ETooManyCredentials);
    assert!(threshold >= 1, EThresholdInvalid);
    assert!(threshold <= len, EThresholdAboveRoster);
    let mut set = vec_set::empty<vector<u8>>();
    while (!creds.is_empty()) {
        let c = creds.pop_back();
        auth::assert_pubkey_length(&c);
        assert!(!auth::is_already_registered(&c, &set), ECredentialAlreadyExists);
        auth::insert_credential(c, &mut set);
    };
    creds.destroy_empty();
    set
}
