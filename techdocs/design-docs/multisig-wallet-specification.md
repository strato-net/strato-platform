# Dedicated MultisigWallet Specification

## Objective

Provide fresh dedicated multisig wallets created through a canonical factory, with no
in-place conversion of existing `User` wallets.

This resolves C1 by eliminating reused storage, hidden authorization mappings, and the creator-controlled setup window.

Regular STRATO accounts, MetaMask accounts, and User wallets remain unchanged.

## Architecture

### MultisigFactory

The canonical factory:

- Registers pending wallet configurations.
- Collects confirmation from every initial signer before deployment.
- Deploys wallets through SolidVM salted deterministic creation.
- Maintains governance-approved logic versions and upgrade paths.
- Cannot create proposals or force upgrades on existing wallets.
- Cannot call any wallet shell entry point with effect.

The factory runs behind the platform's standard `Proxy`. SMD and the backend pin the
factory proxy address, not its implementation address or code-collection hash.

The proxy implementation pointer is initially controlled by `AdminRegistry`. Governance
may upgrade the factory implementation through the standard proxy deployment flow and
may permanently freeze factory implementation upgrades by renouncing the proxy owner.

The logic-version registry has a separate `registryGovernance` authority, initialized
once to `AdminRegistry`. This authority publishes and revokes wallet logic versions and
controls upgrade paths. Freezing the factory proxy therefore does not freeze wallet
logic publication, revocation, or upgrade-path administration.

The deployed factory starts with an empty version registry. Registry governance
publishes each reviewed version and its deployed logic address.

### MultisigWallet

The wallet is the permanent treasury address and proxy shell.

It stores:

- Factory address, set at deployment and immutable.
- Current logic address in the `logicContract` pointer, and current version.
- Upgrade state.
- Upgrade freeze status.
- Configuration epoch.
- Wallet-specific governance state written through delegated logic.

The shell defines two constants that cannot be changed by registry governance, wallet
governance, or a delegated logic version:

- `UPGRADE_DELAY`: the fixed network-wide upgrade delay.
- `UPGRADE_EXPIRY_WINDOW`: seven days after an upgrade becomes executable.

It does not inherit `User`, contain `userAddressMap`, or grant authority to a creator or owner.

### MultisigLogic

The logic contract defines signer, proposal, voting, timelock, and execution behavior.

It executes through delegatecall, so all live state remains under the wallet's address. Approved logic is fully trusted and reviewed for storage compatibility.

`MultisigLogic` is deployed as a concrete implementation, not as a proxy. Wallets store
the approved concrete logic address and adopt later versions individually through their
upgrade process.

### Network deployment

Deployment uses the existing `BaseCodeCollection.sol` and standard proxy tooling:

1. Deploy an empty standard proxy owned by `AdminRegistry`.
2. Install `MultisigFactory` as that proxy's implementation.
3. Initialize `registryGovernance` once to `AdminRegistry`.
4. Deploy the concrete `MultisigLogic` implementation without another proxy.
5. Publish the initial logic version through registry governance.
6. Pin the factory proxy address in backend network configuration.

Factory implementation upgrades reuse the existing proxy. Wallet logic upgrades deploy
and publish a new concrete logic version; they do not replace the factory proxy and are
not automatically applied to wallets.

## Wallet creation

### Configuration

The creator supplies:

- A public, immutable wallet label of at most 64 bytes.
- At least three signer addresses.
- Required approvals `M`.
- Transaction timelock.
- Initial approved logic version.

The factory:

- Assigns a unique internal setup nonce.
- Sorts signer addresses canonically.
- Rejects duplicate and zero addresses.
- Requires `2 <= M < N`.
- Requires the transaction timelock to be at most `MAX_TRANSACTION_TIMELOCK`.
- Requires the initial logic version to be approved and not revoked.
- Computes the setup hash from the factory address and setup nonce.
- Stores the label with the pending setup and includes it in the registration and creation events.

The creator receives no ownership or special authority.

### Signer confirmation

Every initial signer confirms the setup hash before deployment:

- STRATO and MetaMask accounts confirm directly.
- User wallets confirm through an authorized account.
- Existing active multisigs confirm through their own quorum.

Pending setups expire. Before deployment, a pending setup may be cancelled by the creator or by any signer named in it.

Once every signer confirms, the factory rechecks that the initial logic version is still approved and not revoked. If the check passes, it deploys an already-active wallet at a salted address, with initialization atomic with deployment, and emits the wallet address in the canonical creation event. If the check fails, deployment is refused and the setup must be recreated with a current version.

SMD does not show the wallet address before deployment. The salted address remains
computable from public factory state, so funds sent to it before deployment can still
be stranded if the invitation is cancelled or expires.

## Governance

### Issues

Issues contain:

- Target address.
- Function name.
- Canonical argument type names.
- Canonically typed arguments.
- Configuration epoch.
- Nonce.

The nonce is assigned from a wallet-wide monotonically increasing counter when the issue is created. The issue ID is the hash of:

`wallet + epoch + nonce + target + functionName + argumentTypes + typedArguments`

Identical actions can therefore be proposed more than once, and an executed issue's ID can never be reused.

The argument commitment hashes each value through its declared type. Contract-typed values are normalized to their concrete address before hashing. This prevents SolidVM's non-injective default hashing of contract references from allowing one contract argument to be substituted for another.

The number of supplied arguments must exactly equal the number of declared argument
types. Missing or additional variadic values are rejected before the commitment is
created or checked.

STRATO has no separate ETH-like asset. USDST, STRATO, and other asset movements are represented as token contract calls, so issues do not carry a separate native-value field.

### Issue lifecycle

1. A signer creates the issue.
2. Signers approve it.
3. When the Mth distinct approval is recorded, the issue is queued and its transaction timelock starts.
4. After the transaction timelock elapses, any signer may execute the issue.

An unqueued issue expires if it has not reached M approvals within `ISSUE_APPROVAL_LIFETIME`, initially 30 days from creation. Once queued, it expires at `executableAt + ISSUE_EXECUTION_WINDOW`, initially seven days. This separate post-timelock window ensures an issue remains executable even when the transaction timelock is `MAX_TRANSACTION_TIMELOCK`.

An issue is valid only in the epoch in which it was created. Any epoch increment invalidates every unexecuted issue, whether still collecting approvals or already queued.

Expired or invalidated issues do not block recreation of the same proposal; the new issue receives a new nonce.

Queued issues can be cancelled by a normal M-of-N issue whose execution bypasses the
transaction timelock. Upgrade cancellation uses the same immediate-on-quorum rule.

### Signer and threshold changes

Signer or threshold changes:

- Must leave `2 <= M < N`.
- May update signers and M atomically.
- Increment the configuration epoch.
- Invalidate all unexecuted issues from the previous epoch.
- Clear any pending upgrade.
- Void all other open nominations.

New and replacement signers use two-phase activation:

1. The current quorum executes an issue that nominates the signer and records the complete resulting configuration—signer set and M.
2. The nominee proves control by confirming from the nominated address.
3. Confirmation applies the recorded configuration immediately, after rechecking `2 <= M < N`; no second quorum vote is required.

Nominations are bound to the epoch in which they were created. They expire, can be revoked by quorum, and are voided by any epoch increment.

Removals that add no new signer need no nomination and apply when the issue executes.

### Transaction timelock changes

A wallet may change its own transaction timelock through a normal issue. The change:

- Waits out the current, old timelock like any other issue.
- Must not exceed `MAX_TRANSACTION_TIMELOCK`, initially 30 days.
- Increments the configuration epoch, invalidating unexecuted issues and clearing any pending upgrade.

## Upgrade process

Approved logic is fully trusted. The system does not attempt to sandbox delegatecall implementations.

### Approved paths

The factory records approved upgrade edges such as V1 to V2 rather than maintaining only a flat version list.

Revoking a version:

- Prevents new upgrades into it.
- Prevents new wallets from being deployed on it.
- Does not remove approved outbound paths needed by wallets already using it.

### Logic version publication review

Bloc recognises `MultisigWallet` as a proxy and resolves non-shell functions through
the `logicContract` storage pointer. Shell functions remain resolved against the shell.

The wallet shell forwards every call it does not define to the current logic, and it
cannot tell a harmless function from a state-changing one. An externally callable logic
function with no access check can therefore be called by anyone, or by a single signer
without quorum or timelock. The `migrate` prefix rule covers migration functions only;
it does not cover this case.

Before registry governance publishes a logic version, every external or public function
in it must be one of:

- **Guarded:** restricted to signers (`onlySigner`) or to the wallet itself (`onlyWallet`).
- **Migration:** named with the `migrate` prefix, so the shell fallback refuses it.
- **Reviewed as open:** listed explicitly, with a reason, as safe for any caller. For
  version 1 this list is `acceptNomination`, `dismissIssue`, `initialize`, and the
  generated storage getters.

A version containing any other externally callable function must not be published. The
review also confirms that no function uses `msg.sender` after making a wallet self-call,
because the delegated frame observes the wallet as the caller once that call returns.

This review is the only control for this class of defect. It should be enforced by an
automated check in the contract test suite and in the publication step before the first
new logic version is published; until then it is a manual step.

### Scheduling

A quorum-executed wallet self-call schedules an upgrade.

The pending upgrade stores:

- Current version and epoch.
- Target logic and version.
- Optional no-argument migration function name.
- Earliest execution time: `now + UPGRADE_DELAY`.
- Expiration time: `earliest execution time + UPGRADE_EXPIRY_WINDOW`.

Only one upgrade may be pending. A new schedule may overwrite an expired entry.

The upgrade delay cannot be reduced by wallet governance or registry governance.

The factory approval and current-to-target edge are checked when scheduling. Scheduling fails if upgrades are frozen.

### Migration commitment

The pending upgrade stores only an optional migration function name. Migration functions
accept no arguments and read any required inputs from existing wallet storage or
implementation constants. An empty function name means no migration.

Executors cannot supply a migration function or arguments. This prevents permissionless
execution from substituting values that collide under SolidVM's raw variadic hashing.

Every migration function name must begin with `migrate`. The permanent wallet shell
rejects that prefix in its fallback, so migration functions can be reached only by
`executeUpgrade` during the atomic upgrade. State-changing setup or initialization
functions outside the `migrate` prefix are rejected by the logic version publication
review described above.

### Execution

Anyone may call `executeUpgrade`.

Execution:

1. Confirms a pending upgrade exists and upgrades are not frozen.
2. Confirms the earliest execution time has passed.
3. Confirms the pending upgrade has not expired.
4. Confirms the wallet's current version and epoch match the values stored in the pending upgrade.
5. Rechecks that the target is approved and not revoked.
6. Rechecks the current-to-target edge.
7. Updates the logic address and version and clears the pending upgrade.
8. Increments the shell-owned epoch.
9. Executes the stored no-argument migration function atomically through the new logic.

If any step fails, including migration, the entire upgrade reverts: the logic address, version, epoch, and pending upgrade are all unchanged.

A separately callable or unprotected initializer is prohibited.

### Cancellation

Upgrade cancellation requires M-of-N approval but bypasses the wallet's general transaction timelock: it executes when the Mth approval is recorded. This ensures cancellation can execute before the upgrade delay expires.

A dissenting minority has no unilateral veto. The delay gives registry governance time to revoke the target and gives the approving quorum time to reconsider.

### Permanent freeze

`freezeUpgrades` requires normal M-of-N approval and remains subject to the wallet's transaction timelock.

When executed, it:

- Clears any pending upgrade.
- Permanently disables future upgrades.

A queued freeze is invalidated if an upgrade executes first because execution increments the epoch. Signers wishing to freeze instead of upgrading must cancel the pending upgrade first.

A frozen wallet can never receive security fixes and remains exposed to bugs discovered later.

## Shell entry points

The shell reserves:

- `scheduleUpgrade`
- `cancelUpgrade`
- `executeUpgrade`
- `freezeUpgrades`
- The stateless `argumentAt` bounds probe used to enforce exact variadic argument counts.
- The `migrate` function-name prefix, which the fallback refuses and only upgrade
  execution may delegate to.
- The self-call used to increment the epoch and clear pending upgrades after signer, threshold, or timelock changes.

`scheduleUpgrade`, `cancelUpgrade`, `freezeUpgrades`, and epoch mutation accept calls only from the wallet itself.

`executeUpgrade` is externally callable by anyone after approval and delay.

Shell fields are written only by shell functions. Logic reads the epoch and upgrade state but changes them only through the reserved self-calls.

`argumentAt` is permanently available on the shell so later logic versions cannot omit
the exact-count check's probe. It has no state access or authorization effect.

Shell function names are prohibited in logic ABIs to avoid dispatch ambiguity; registry approval review rejects any logic that declares one. Shell storage uses distinctive reserved names to reduce accidental SolidVM name collisions.

## SMD behavior

### Creation wizard

SMD displays:

- The public wallet label alongside the wallet address.
- Signer identities and account types.
- M-of-N requirement.
- Transaction timelock.
- Initial approved version.
- Setup hash.
- Signer-confirmation progress.

It routes confirmations according to signer type and deploys after all confirmations.

### Verification

SMD marks a wallet as factory-created only after verifying:

- The configured factory proxy address is pinned for the current network.
- The factory proxy has a current implementation.
- The factory proxy is owned by `AdminRegistry` or is permanently frozen.
- The factory's separate `registryGovernance` is `AdminRegistry`.
- The wallet's stored factory address is the pinned factory.
- The wallet is registered in that factory.
- The current logic address and version are approved and not revoked in the registry.
- The wallet is active.

If any check fails, SMD keeps wallet actions read-only and displays the failed
provenance checks.

### Issue review

Every issue card displays:

- Full target address.
- Function.
- Typed arguments.
- Nonce, epoch, and expiry.

Token approvals prominently display spender and amount, including warnings for unlimited approvals.

### Upgrade review

SMD displays:

- Current and target versions.
- Current and target logic addresses.
- Optional no-argument migration function.
- Upgrade path.
- Earliest execution and expiry.
- Revocation status.
- Cancellation and freeze consequences.

Pending upgrades receive a prominent wallet-wide warning.

### No legacy conversion path

Dedicated multisigs are a new production implementation. SMD does not convert `User`
wallets, recognize legacy `Multisig.sol` wallets, or provide a migration mode. Existing
regular `User` wallets remain regular wallets and the dedicated multisig UI is based
only on factory-created `MultisigWallet` contracts.

## Security boundary

The pinned factory proxy and registry governance determine which logic versions are
eligible. Factory implementation upgrades and wallet-logic registry administration are
separate authorities, even though both initially route through `AdminRegistry`.

Protocol governance cannot upgrade an existing wallet by itself. The wallet's own quorum must select an approved path and wait through the fixed delay. Governance cannot shorten that delay or replace the factory to which a wallet is bound.

A governance-approved implementation is fully trusted once adopted. It can access all wallet storage and assets through delegatecall. Review of implementation behavior and storage compatibility is therefore the primary upgrade security boundary.

The upgrade controls reduce accidental and look-alike upgrades. They do not protect against malicious or defective governance-approved logic.

## Accepted risks

- **No recovery authority:** No party outside the wallet's own quorum can move funds, change signers, or upgrade the wallet.
- **Logic liveness failure:** Upgrades are approved through the current logic. If that logic becomes unable to vote or execute, the wallet cannot upgrade and its assets may be permanently stuck.
- **Key loss:** The wallet tolerates the loss of at most `N - M` signer keys. Beyond that, it cannot act.
- **Frozen wallets:** A wallet with frozen upgrades can never receive fixes.
- **Unguarded logic functions:** The shell cannot detect a logic function published
  without an access check. Protection rests on the logic version publication review, the
  wallet quorum's own choice to adopt a version, and the upgrade delay.
- **Factory governance:** Before the factory proxy is frozen, `AdminRegistry` can change
  factory code. Registry governance can continue changing eligible wallet logic versions
  and upgrade paths after the proxy is frozen, but cannot make a wallet adopt a version.

## SolidVM assumptions to verify

- SolidVM salted deterministic deployment is available and commits to the factory, code collection, contract name, salt, and full constructor configuration.
- Delegatecall preserves storage context and `msg.sender`.
- Dispatch uses a function name and typed arguments represented by canonical SolidVM RLP encoding, matching the migration and issue hashes.
- Storage is keyed by variable name, matching the collision assumptions.
- Cirrus indexes delegated state under the wallet address.

## Required tests

### Creation

- Factory proxy upgrades preserve setup, wallet-registration, and version-registry state.
- Only the proxy owner can upgrade the factory implementation.
- Freezing factory implementation upgrades does not disable registry governance.
- Only registry governance can publish, revoke, or connect logic versions, and it can be
  rotated only by the current registry governance.
- Hidden `userAddressMap` authority cannot be introduced.
- Hidden `adminMap` signers cannot be introduced.
- The creator cannot leave a pending signer or retain authority.
- Every initial signer type can confirm setup.
- Duplicate, zero, and future wallet addresses are rejected as signers.
- Deployment cannot complete unless every initial signer proves control.
- The factory counter assigns a unique setup hash and deployment address to every registered setup.
- Labels longer than 64 bytes are rejected, and the accepted label remains available after deployment.
- Pending setups expire and can be cancelled by the creator or a named signer, and by no one else.
- A setup whose initial version was revoked while pending cannot deploy.
- Initialization cannot be called again after deployment.

### Governance

- `2 <= M < N` is enforced after every configuration change.
- An issue cannot execute before M approvals and the transaction timelock.
- Identical issues receive distinct IDs; an executed issue cannot be replayed.
- Boolean, integer, string, address, and contract-typed arguments cannot collide or be substituted after proposal.
- Issues expire under the applicable approval or execution window and can be recreated.
- Pending nominees expire and can be revoked.
- Nominee confirmation applies exactly the recorded configuration.
- Open nominations are voided by an epoch increment.
- Timelock changes wait out the old timelock, respect the maximum, and increment the epoch.

### Upgrades

- Only approved upgrade edges can be scheduled.
- Revocation blocks entry but preserves outbound recovery paths.
- A target revoked during the delay fails at execution.
- Executors cannot supply or substitute migration arguments.
- The stored no-argument migration function executes atomically, and an empty function
  name performs no migration.
- Migration-prefixed functions cannot be called through the fallback before or after an
  upgrade, while ordinary logic functions remain reachable.
- Scheduling rejects a non-empty migration function without the `migrate` prefix.
- Upgrade execution is permissionless only after the delay.
- An expired upgrade cannot execute and can be overwritten by a new schedule.
- Execution fails on an epoch or version mismatch.
- A failed migration reverts the logic address, version, epoch, and pending upgrade.
- Cancellation bypasses the transaction timelock.
- Signer, threshold, and timelock changes clear pending upgrades.
- Upgrade execution invalidates old issues.
- A queued freeze is invalidated by an executed upgrade.
- Freeze is irreversible, clears pending upgrades, and blocks scheduling and execution.
- The factory cannot call any shell entry point with effect.
- Registry approval rejects a logic contract that declares a shell function name.
- Static review and reference-implementation tests verify that logic changes shell fields only through reserved self-calls. This is not a runtime sandbox against approved delegatecall logic.

### SolidVM

- Delegatecall storage context and sender behavior match the assumptions.
- Dispatch hashing is canonical.
- Shell and logic storage names do not collide.
- Cirrus indexes delegated state under the wallet address.
- Salted deployment behaves as the specification assumes.
