/// Operator gate for mpckitcore.
///
/// `OperatorCap` is the owned-object permission to call any storage-
/// mutating entrypoint (`register_account`, `request_dkg_*`, etc.).
/// It exists so the backend (or any other tenant) can rate-limit and
/// police account creation off-chain. Storage-mutating entrypoints
/// have no per-user signature gate because the cryptographic auth
/// lives at the coordinator layer, so we gate by capability instead.
///
/// `AdminCap` mints and revokes `OperatorCap`s. The deployer keeps it.
/// Self-hosters get their own `AdminCap` from `init` and can run
/// multiple `OperatorCap`s on a single deployment.
module mpckitcore::acl;

public struct AdminCap has key, store {
    id: UID,
}

public struct OperatorCap has key, store {
    id: UID,
}

fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::public_transfer(OperatorCap { id: object::new(ctx) }, ctx.sender());
}

public fun mint_operator(_: &AdminCap, recipient: address, ctx: &mut TxContext) {
    transfer::public_transfer(OperatorCap { id: object::new(ctx) }, recipient);
}

public fun burn_operator(_: &AdminCap, cap: OperatorCap) {
    let OperatorCap { id } = cap;
    id.delete();
}
