# Native Bridge Contract Workflows

This document summarizes the native bridge contracts, state transitions, and expected workflows for audit review.

## Contracts

### STRATO Contracts

#### `StratoNativeBridge`

Coordinator contract for STRATO-native bridge flows.

Responsibilities:

- Stores native route configuration per `stratoToken` and `externalChainId`.
- Enforces route enablement, per-withdrawal caps, and `instantWithdrawalThreshold`.
- Records external-chain redemptions as STRATO-side native deposits.
- Creates STRATO-to-external native withdrawal records.
- Tracks withdrawal lane choice through `useInstantPath`.
- Tracks delayed instant execution through `nativeMintNotBefore`.
- Records manual lane proposal references through `nativeMintProposalHash`.
- Controls deposit and withdrawal state transitions.
- Delegates token custody to `StratoNativeCustodyVault`.

Main privileged actors:

- `owner`: governance/admin for route config, contract wiring, delay config, and unpausing.
- `bridgeOperator`: relayer/operator that records, confirms, finalizes, or aborts bridge lifecycle steps.
- `guardian`: emergency pause authority.

#### `StratoNativeCustodyVault`

STRATO-side custody contract for locked native assets.

Responsibilities:

- Pulls STRATO-native tokens from users during native bridge-out.
- Releases STRATO-native tokens to recipients during native bridge-in.
- Tracks `lockedBalance[token]`.
- Allows only the configured `StratoNativeBridge` to call `lock` and `unlock`.
- Provides a separate pause switch for custody operations.

### External EVM Contracts

#### `StratoNativeRepresentationBridge`

External-chain controller for representation token minting and redemptions.

Responsibilities:

- Stores STRATO token to representation token mappings.
- Allows users to request redemption back to STRATO by transferring representation tokens to the bridge and burning them.
- Emits `RedemptionRequested` events for the STRATO relayer.
- Mints representation tokens through `mintRepresentationWithAttestation`.
- Validates EIP-712 native mint attestations before minting.
- Enforces replay protection through `processedMints`.
- Supports route disable/enable/freeze/migration controls.
- Supports mint and redemption pause controls.

Main privileged roles:

- `DEFAULT_ADMIN_ROLE`: role administrator.
- `UPGRADER_ROLE`: proxy upgrades.
- `MAPPING_ADMIN_ROLE`: route registration, disable, enable, freeze, and migration.
- `PAUSER_ROLE` / `UNPAUSER_ROLE`: emergency controls.
- `ATTESTATION_ADMIN_ROLE`: signer set and threshold configuration.

#### `StratoNativeRepresentationToken`

External-chain ERC-20 representation of a STRATO-native asset.

Responsibilities:

- Provides the transferable wrapped/representation token on the external chain.
- Allows minting only to accounts with `BRIDGE_ROLE`.
- Allows burning only by accounts with `BRIDGE_ROLE`, from the bridge contract's own balance.
- Supports upgradeability through `UPGRADER_ROLE`.

Expected setup:

- The representation bridge has `BRIDGE_ROLE` on the representation token.
- Users do not mint or burn directly.

## Shared Status Model

Native deposits and withdrawals use `BridgeTypes.BridgeStatus`.

- `NONE`: default unset mapping state.
- `INITIATED`: lifecycle has been recorded.
- `PENDING_REVIEW`: waiting for review, delayed execution, proposal, or external confirmation.
- `COMPLETED`: lifecycle finished.
- `ABORTED`: lifecycle cancelled or rejected.

## Route Configuration

`StratoNativeBridge` stores a `NativeAssetConfig` for each `stratoToken` and `externalChainId`.

Fields:

- `enabled`: route is active.
- `externalChainId`: destination/source external chain.
- `externalBridge`: external representation bridge expected for this route.
- `representationToken`: external wrapped token.
- `externalName` / `externalSymbol`: display metadata.
- `maxPerWithdrawal`: hard per-withdrawal limit, where `0` disables the cap.
- `instantWithdrawalThreshold`: amount eligible for the instant lane, where `0` disables instant lane.
- `stratoToken`: STRATO-native token backing the route.

Route mappings must match on both sides:

- STRATO route: `stratoToken -> externalChainId -> representationToken`.
- External route: `stratoToken -> representationToken`.

## Workflow: External to STRATO Native Bridge-In

Purpose: user redeems external representation tokens and receives the underlying STRATO-native token.

### Step 1: User Requests Redemption on External Chain

The user calls `StratoNativeRepresentationBridge.requestRedemption(representationToken, amount, stratoRecipient)`.

External contract behavior:

- Confirms the representation token is mapped and route is active.
- Pulls representation tokens from the user into the bridge.
- Burns the bridge-held representation tokens.
- Increments `redemptionId`.
- Emits `RedemptionRequested(representationToken, amount, sender, stratoRecipient, redemptionId)`.

External state:

- Representation token supply decreases.
- No STRATO state changes yet.
- The redemption is source-final on the external chain: there is no automatic Sepolia refund path after the burn.

### Step 2: Relayer Records Deposit on STRATO

The relayer observes the external redemption event and calls `StratoNativeBridge.recordDeposit(...)`.

STRATO contract behavior:

- Builds `depositId = keccak256(externalChainId, externalBridge, externalRedemptionId)`.
- Rejects duplicate `depositId`.
- Resolves `stratoToken` from `stratoTokenByRepresentation[representationToken][externalChainId]`.
- Confirms the route is enabled and matches the expected external bridge and representation token.
- Stores `NativeDepositInfo` with `bridgeStatus = INITIATED`.
- Emits `NativeDepositInitiated`.

State transition:

```text
NONE -> INITIATED
```

### Step 3: Deposit Is Confirmed or Reviewed

If verification passes, the relayer calls `confirmDeposit(...)`.

STRATO contract behavior:

- Allows confirmation from `INITIATED` or `PENDING_REVIEW`.
- Calls `StratoNativeCustodyVault.unlock(stratoToken, stratoRecipient, amount)`.
- Sets deposit status to `COMPLETED`.
- Emits `NativeDepositCompleted`.

State transition:

```text
INITIATED -> COMPLETED
PENDING_REVIEW -> COMPLETED
```

If verification fails or needs manual review, the relayer may call `reviewDeposit(...)`.

State transition:

```text
INITIATED -> PENDING_REVIEW
```

If rejected, the bridge operator may call `abortDeposit(...)`.

State transition:

```text
INITIATED -> ABORTED
PENDING_REVIEW -> ABORTED
```

Abort meaning:

- `abortDeposit` is a STRATO-side rejection or escalation marker.
- It does not re-mint representation tokens on the external chain.
- If a redemption cannot be completed after a valid external burn, Safe/admin operators must intervene manually, either by fixing the STRATO-side issue and confirming the deposit or by performing a controlled compensating action on the external chain.
- Automatic external refunds are intentionally not part of the current redemption flow because re-minting after a burn is privileged and can create supply risk if the STRATO unlock later succeeds.

## Workflow: STRATO to External Native Bridge-Out

Purpose: user locks a STRATO-native token and receives external representation tokens.

### Step 1: User Requests Withdrawal on STRATO

The user approves `StratoNativeCustodyVault`, then calls `StratoNativeBridge.requestWithdrawal(externalChainId, externalRecipient, stratoToken, amount)`.

STRATO contract behavior:

- Confirms withdrawals are not paused.
- Loads and validates route config.
- Enforces `maxPerWithdrawal` if configured.
- Confirms the STRATO token is active.
- Calls `StratoNativeCustodyVault.lock(stratoToken, user, amount)`.
- Computes lane choice:

```text
useInstantPath = instantWithdrawalThreshold > 0 && actualLockedAmount <= instantWithdrawalThreshold
```

- Stores `NativeWithdrawalInfo` with `bridgeStatus = INITIATED`.
- Emits `NativeWithdrawalRequested(..., useInstantPath)`.

State transition:

```text
NONE -> INITIATED
```

Custody state:

```text
user balance decreases
vault balance increases
lockedBalance[stratoToken] increases
```

### Step 2A: Instant Lane Is Marked Pending

For withdrawals with `useInstantPath = true`, the bridge operator calls `markWithdrawalPending(id)`.

STRATO contract behavior:

- Requires status `INITIATED`.
- Sets status to `PENDING_REVIEW`.
- Sets `nativeMintNotBefore = block.timestamp + INSTANT_WITHDRAWAL_DELAY_SECONDS`.
- Emits `NativeWithdrawalPending`.

State transition:

```text
INITIATED -> PENDING_REVIEW
```

Effect:

- The STRATO contract records when the destination-chain mint is allowed to occur.
- The STRATO contract does not execute the external-chain mint itself.

### Step 2B: Manual Lane Proposal Is Recorded

For withdrawals with `useInstantPath = false`, the bridge operator can mark the withdrawal pending and then record a proposal reference.

STRATO contract behavior:

- `markWithdrawalPending(id)` moves the withdrawal to `PENDING_REVIEW`.
- `recordWithdrawalProposal(id, nativeMintProposalHash)` records the external proposal reference.
- `recordWithdrawalProposal` requires no existing `externalTxHash` and no existing proposal hash.
- Emits `NativeWithdrawalProposalRecorded`.

State transition:

```text
INITIATED -> PENDING_REVIEW
```

Manual lane meaning:

- The STRATO withdrawal remains pending while external approval or execution occurs.
- The contract records the proposal reference but does not approve or execute it.

### Step 3: External Representation Mint

The external mint is performed on `StratoNativeRepresentationBridge`.

The current external contract uses `mintRepresentationWithAttestation(attestation, signatures)`.

External contract behavior:

- Validates the attestation fields:
  - `sourceChainId` is non-zero.
  - `sourceBridge` is non-zero.
  - `sourceWithdrawalId` is non-zero.
  - `destinationChainId == block.chainid`.
  - `destinationBridge == address(this)`.
  - `recipient` is non-zero.
  - `amount` is non-zero.
  - `notBefore <= block.timestamp`.
  - `deadline >= block.timestamp`.
  - `deadline <= notBefore + maxAttestationValiditySeconds`.
  - `stratoToken` is mapped to the supplied `representationToken`.
  - route is active.
- Verifies sorted valid signatures from configured `attestationSigners`.
- Requires signature count to satisfy `attestationThreshold`.
- Computes replay key:

```text
mintId = keccak256(sourceChainId, sourceBridge, sourceWithdrawalId)
```

- Rejects already processed `mintId`.
- Marks `processedMints[mintId] = true`.
- Calls `StratoNativeRepresentationToken.mint(recipient, amount)`.
- Emits `RepresentationMinted`.

External state:

```text
processedMints[mintId] = true
recipient representation token balance increases
representation token total supply increases
```

### Step 4: STRATO Withdrawal Is Finalized

After the external mint transaction succeeds, the bridge operator calls `StratoNativeBridge.finalizeWithdrawal(id, externalTxHash, nativeMintProposalHash)`.

STRATO contract behavior:

- Requires status `PENDING_REVIEW`.
- Requires a non-empty `externalTxHash`.
- Stores normalized `externalTxHash`.
- Optionally stores normalized `nativeMintProposalHash` if supplied and not already recorded.
- Sets status to `COMPLETED`.
- Emits `NativeWithdrawalCompleted`.

State transition:

```text
PENDING_REVIEW -> COMPLETED
```

Custody state:

- STRATO tokens remain locked in the custody vault as backing for external representation supply.

### Withdrawal Abort Path

`abortWithdrawal(id)` can unlock funds back to the STRATO sender.

Operator or whitelisted abort:

- Allowed from `INITIATED` or `PENDING_REVIEW`.
- Not allowed after `externalTxHash` is set.

User abort:

- Only original `stratoSender`.
- Only while status is `INITIATED`.
- Only after `requestedAt + WITHDRAWAL_ABORT_DELAY`.

STRATO contract behavior:

- Sets status to `ABORTED`.
- Calls `StratoNativeCustodyVault.unlock(stratoToken, stratoSender, amount)`.
- Emits `NativeWithdrawalAborted`.

State transition:

```text
INITIATED -> ABORTED
PENDING_REVIEW -> ABORTED
```

Custody state:

```text
vault balance decreases
lockedBalance[stratoToken] decreases
user balance increases
```

## State Transition Summary

### Native Deposit

```text
NONE
  -> INITIATED        recordDeposit
  -> PENDING_REVIEW   reviewDeposit
  -> COMPLETED        confirmDeposit
  -> ABORTED          abortDeposit
```

Allowed completion paths:

```text
INITIATED -> COMPLETED
PENDING_REVIEW -> COMPLETED
```

Allowed abort paths:

```text
INITIATED -> ABORTED
PENDING_REVIEW -> ABORTED
```

### Native Withdrawal

```text
NONE
  -> INITIATED        requestWithdrawal
  -> PENDING_REVIEW   markWithdrawalPending
  -> COMPLETED        finalizeWithdrawal
  -> ABORTED          abortWithdrawal
```

External execution metadata while pending:

```text
PENDING_REVIEW -> PENDING_REVIEW   recordWithdrawalProposal
```

Completion is atomic:

```text
PENDING_REVIEW -> COMPLETED        finalizeWithdrawal(id, externalTxHash, nativeMintProposalHash)
```

## Security-Relevant Invariants

- `StratoNativeBridge` does not custody tokens directly; token custody is isolated in `StratoNativeCustodyVault`.
- `StratoNativeCustodyVault.lock` and `unlock` are callable only by the configured bridge.
- A native deposit is keyed by `(externalChainId, externalBridge, externalRedemptionId)` and cannot be recorded twice.
- A native external mint is keyed by `(sourceChainId, sourceBridge, sourceWithdrawalId)` and cannot be processed twice.
- Native redemptions burn representation tokens on the external chain before STRATO unlock; aborting the STRATO-side deposit does not automatically refund the external burn.
- STRATO route configuration and external route mapping must agree.
- External route disablement is reversible through `enableTokenMapping`; route freezing is intentionally irreversible.
- `maxPerWithdrawal` limits individual bridge-out requests.
- `instantWithdrawalThreshold` determines whether a withdrawal is instant-lane eligible.
- `nativeMintNotBefore` delays instant-lane destination mint eligibility.
- Manual lane withdrawals are not automatically executed by the STRATO contract.
- Withdrawals cannot be aborted after destination execution has been recorded.
- External minting requires valid EIP-712 attestations from configured attestation signers.
- Pauses exist independently for STRATO deposits, STRATO withdrawals, vault custody operations, external mints, and external redemptions.
- User abort after delay is available only before the withdrawal is moved out of `INITIATED`.
- Operator/whitelisted abort can handle pending review cases.


