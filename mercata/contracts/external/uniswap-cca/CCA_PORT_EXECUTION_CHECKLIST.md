# CCA Port Execution Checklist

This document turns the standalone CCA STRATO port into an execution checklist.

It is intentionally practical:

- what to change
- where to change it
- why it is needed
- how to verify it before moving on

Use this together with `CCA_PARITY_PLAN.md`.

## Goal

Port the reduced standalone CCA core in this folder to STRATO while preserving the original auction behavior.

Success means:

- the reduced core compiles on STRATO
- the ported contracts preserve auction behavior
- parity can be demonstrated using the plan in `CCA_PARITY_PLAN.md`

## Current Known Compiler Blockers

These are the active issues observed on the reduced core:

1. `$`-prefixed identifiers are rejected by the STRATO parser
2. user-defined value types and `using ... global` are rejected
3. inline assembly in core libraries is not compiling
4. `ReentrancyGuardTransient` is not compatible as imported
5. `StepStorage` still depends on `SSTORE2` patterns that are not suitable for STRATO

## Porting Principles

- preserve behavior, not gas-optimized EVM implementation details
- prefer straightforward Solidity over clever storage/assembly tricks
- remove unsupported abstractions early
- keep the deployable surface small
- verify each file compiles before moving to the next layer

## Scope

Primary concrete files:

- `src/ContinuousClearingAuction.sol`
- `src/BidStorage.sol`
- `src/CheckpointStorage.sol`
- `src/StepStorage.sol`
- `src/TickStorage.sol`
- `src/TokenCurrencyStorage.sol`

Primary supporting files:

- `src/libraries/BidLib.sol`
- `src/libraries/CheckpointAccountingLib.sol`
- `src/libraries/CheckpointLib.sol`
- `src/libraries/ConstantsLib.sol`
- `src/libraries/CurrencyLibrary.sol`
- `src/libraries/FixedPoint96.sol`
- `src/libraries/MaxBidPriceLib.sol`
- `src/libraries/StepLib.sol`
- `src/libraries/ValidationHookLib.sol`
- `src/libraries/ValueX7Lib.sol`
- `src/interfaces/`

## Phase 0: Freeze Scope

### Checklist

- [ ] Do not reintroduce factory, v4, lens, or periphery code during the port.
- [ ] Keep the deployable target limited to the standalone auction core.
- [ ] Keep `CCA_PARITY_PLAN.md` as the acceptance contract for behavior.

### Verification Gate

- [ ] The folder still contains only the reduced standalone CCA subset.

## Phase 1: Remove Parser-Level Blockers

### 1. Rename `$`-Prefixed Identifiers

Files to inspect first:

- `src/ContinuousClearingAuction.sol`
- `src/StepStorage.sol`
- `src/CheckpointStorage.sol`
- `src/BidStorage.sol`
- `src/TickStorage.sol`
- any interfaces or libraries that reference the renamed fields indirectly

### Checklist

- [ ] Replace every `$...` identifier with a normal Solidity identifier.
- [ ] Use a consistent naming scheme, for example:
  - `$clearingPrice` -> `_clearingPrice`
  - `$_tokensReceived` -> `_tokensReceived`
  - `$lastCheckpointedBlock` -> `_lastCheckpointedBlock`
- [ ] Update all internal reads/writes after the rename.
- [ ] Recheck inheritance conflicts after renaming shared storage fields.

### Why

This is the first parser failure in the main auction contract. Until this is fixed, deeper compile issues stay hidden.

### Verification Gate

- [ ] `solid-vm-cli compile "ContinuousClearingAuction.sol"` moves past the `$` parser error.

## Phase 2: Remove Unsupported Type Abstractions

### 2. Replace `Currency` User-Defined Value Type

Primary files:

- `src/libraries/CurrencyLibrary.sol`
- `src/TokenCurrencyStorage.sol`
- `src/interfaces/ITokenCurrencyStorage.sol`
- `src/ContinuousClearingAuction.sol`

### Checklist

- [ ] Replace `type Currency is address;` with plain `address`.
- [ ] Remove `using CurrencyLibrary for Currency global`.
- [ ] Rewrite library functions to accept `address currency`.
- [ ] Replace any `Currency.wrap(...)` or `Currency.unwrap(...)` usage with plain address operations.
- [ ] Update interfaces and storage getters accordingly.

### Why

The compiler is currently stopping at `using CurrencyLibrary for Currency global`.

### Verification Gate

- [ ] `solid-vm-cli compile "libraries/CurrencyLibrary.sol"` passes the former `using` parser error.

### 3. Replace `ValueX7` User-Defined Value Type

Primary files:

- `src/libraries/ValueX7Lib.sol`
- `src/libraries/CheckpointLib.sol`
- `src/libraries/CheckpointAccountingLib.sol`
- `src/CheckpointStorage.sol`
- `src/TokenCurrencyStorage.sol`
- `src/ContinuousClearingAuction.sol`
- `src/interfaces/IContinuousClearingAuction.sol`

### Checklist

- [ ] Replace `type ValueX7 is uint256;` with plain `uint256`.
- [ ] Rewrite helper functions so they operate on `uint256`.
- [ ] Remove any `.wrap()` and `.unwrap()` usage.
- [ ] Keep the `_X7` semantic suffix in variable names where it helps preserve meaning.
- [ ] Verify scaling semantics remain unchanged.

### Why

Even if the compiler does not fail here first, this abstraction is likely to create STRATO parser or compatibility friction and should be simplified early.

### Verification Gate

- [ ] `ValueX7`-related files compile with plain `uint256` usage.

## Phase 3: Remove Unsupported Low-Level EVM Patterns

### 4. Replace `ReentrancyGuardTransient`

Primary files:

- `src/ContinuousClearingAuction.sol`
- `solady/utils/ReentrancyGuardTransient.sol` or any local replacement

### Checklist

- [ ] Stop inheriting from `ReentrancyGuardTransient`.
- [ ] Introduce a simple STRATO-safe reentrancy guard.
- [ ] Apply the replacement guard only to functions that actually need it.
- [ ] Verify call ordering does not change external behavior.

### Suggested Simplification

Use a standard boolean lock pattern:

- `bool _entered`
- `require(!_entered)`
- set true before body
- set false after body

### Why

The imported guard uses transient storage opcodes and inline assembly.

### Verification Gate

- [ ] The auction contract no longer imports or inherits from `ReentrancyGuardTransient`.
- [ ] The replacement guard compiles on STRATO.

### 5. Remove Inline Assembly From `StepLib`

Primary file:

- `src/libraries/StepLib.sol`

### Checklist

- [ ] Rewrite packed step parsing in plain Solidity.
- [ ] Preserve the exact packing semantics for `uint24 mps` + `uint40 blockDelta`.
- [ ] Recheck step boundary validation logic after the rewrite.

### Why

This file currently fails inside an assembly block.

### Verification Gate

- [ ] `solid-vm-cli compile "libraries/StepLib.sol"` succeeds.

### 6. Remove Inline Assembly From `CurrencyLibrary`

Primary file:

- `src/libraries/CurrencyLibrary.sol`

### Checklist

- [ ] Replace native transfer assembly with normal Solidity calls where possible.
- [ ] Replace ERC20 low-level transfer assembly with direct interface calls and explicit success checks.
- [ ] Preserve failure behavior for unsuccessful native/ERC20 transfers.

### Why

This file combines unsupported type abstractions and assembly-heavy transfer logic.

### Verification Gate

- [ ] `solid-vm-cli compile "libraries/CurrencyLibrary.sol"` succeeds.

## Phase 4: Replace STRATO-Unfriendly Storage Tricks

### 7. Rewrite `StepStorage` Without `SSTORE2`

Primary files:

- `src/StepStorage.sol`
- `src/libraries/StepLib.sol`
- `src/interfaces/IStepStorage.sol`

### Checklist

- [ ] Remove `SSTORE2` imports and usage.
- [ ] Replace pointer-based storage with normal on-chain storage.
- [ ] Simplest option: decode `auctionStepsData` in the constructor and store parsed steps in an array.
- [ ] Preserve start/end block validation and progression behavior.
- [ ] Confirm that step iteration returns the same sequence as the original implementation.

### Why

This is one of the highest-risk implementation rewrites because it affects issuance timing across the whole auction.

### Verification Gate

- [ ] `solid-vm-cli compile "StepStorage.sol"` succeeds.
- [ ] A fixed sample `auctionStepsData` decodes to the same sequence as the original implementation.

## Phase 5: Compile Core Storage Layers

### 8. Port `BidStorage`

Primary file:

- `src/BidStorage.sol`

### Checklist

- [ ] Reconcile renamed state fields if needed.
- [ ] Verify bid creation and retrieval remain unchanged.
- [ ] Keep storage layout behavior stable relative to the ported auction.

### Verification Gate

- [ ] `solid-vm-cli compile "BidStorage.sol"` succeeds.

### 9. Port `TickStorage`

Primary file:

- `src/TickStorage.sol`

### Checklist

- [ ] Remove any parser-incompatible names.
- [ ] Keep linked-list / tick ordering logic unchanged.
- [ ] Confirm floor price and tick spacing logic still matches original semantics.

### Verification Gate

- [ ] `solid-vm-cli compile "TickStorage.sol"` succeeds.

### 10. Port `TokenCurrencyStorage`

Primary file:

- `src/TokenCurrencyStorage.sol`

### Checklist

- [ ] Update for plain `address currency`.
- [ ] Update all `ValueX7` usage if converted to plain `uint256`.
- [ ] Keep required currency raised calculations behaviorally identical.

### Verification Gate

- [ ] `solid-vm-cli compile "TokenCurrencyStorage.sol"` succeeds.

### 11. Port `CheckpointStorage`

Primary file:

- `src/CheckpointStorage.sol`

### Checklist

- [ ] Update renamed fields.
- [ ] Update `ValueX7` usage.
- [ ] Confirm checkpoint insertion and lookup logic is unchanged.

### Verification Gate

- [ ] `solid-vm-cli compile "CheckpointStorage.sol"` succeeds.

## Phase 6: Compile Support Libraries

### 12. Port Remaining Libraries In Dependency Order

Suggested order:

1. `src/libraries/FixedPoint96.sol`
2. `src/libraries/ConstantsLib.sol`
3. `src/libraries/BidLib.sol`
4. `src/libraries/StepLib.sol`
5. `src/libraries/CurrencyLibrary.sol`
6. `src/libraries/ValueX7Lib.sol`
7. `src/libraries/CheckpointLib.sol`
8. `src/libraries/CheckpointAccountingLib.sol`
9. `src/libraries/MaxBidPriceLib.sol`
10. `src/libraries/ValidationHookLib.sol`

### Checklist

- [ ] Compile each library individually as soon as it is ported.
- [ ] Avoid moving to the main auction contract while a dependency still has unresolved parser issues.
- [ ] Record any semantic changes caused by simplification.

### Verification Gate

- [ ] All remaining support libraries compile cleanly.

## Phase 7: Rebuild the Main Auction

### 13. Port `ContinuousClearingAuction.sol`

Primary file:

- `src/ContinuousClearingAuction.sol`

### Checklist

- [ ] Update renamed storage fields.
- [ ] Update plain-address currency handling.
- [ ] Update plain-`uint256` `ValueX7` handling if adopted.
- [ ] Replace any reentrancy modifier usage.
- [ ] Keep public entrypoints and settlement behavior aligned with the reduced original contract.
- [ ] Preserve event emission behavior where possible.

### Verification Gate

- [ ] `solid-vm-cli compile "ContinuousClearingAuction.sol"` succeeds.

## Phase 8: Interface Stabilization

### 14. Reconcile Interfaces With Ported Types

Primary files:

- `src/interfaces/IContinuousClearingAuction.sol`
- `src/interfaces/IBidStorage.sol`
- `src/interfaces/ICheckpointStorage.sol`
- `src/interfaces/IStepStorage.sol`
- `src/interfaces/ITickStorage.sol`
- `src/interfaces/ITokenCurrencyStorage.sol`
- `src/interfaces/IValidationHook.sol`
- `src/interfaces/external/IERC20Minimal.sol`
- `src/interfaces/external/IDistributionContract.sol`

### Checklist

- [ ] Update interfaces to match the ported concrete implementations.
- [ ] Keep the externally visible contract surface as close to the reduced original as possible.
- [ ] Avoid unnecessary interface churn once the main contract compiles.

### Verification Gate

- [ ] All interfaces and implementing contracts compile together.

## Phase 9: Functional Verification

### 15. Execute the Parity Plan

Reference:

- `CCA_PARITY_PLAN.md`

### Checklist

- [ ] Run deterministic golden scenarios.
- [ ] Capture differential traces against the reduced original implementation.
- [ ] Compare economically meaningful state after every action.
- [ ] Validate invariants.
- [ ] Resolve any divergence before claiming parity.

### Verification Gate

- [ ] Core scenarios match on final settlement outcomes.
- [ ] Partial-fill and graduation boundary cases match exactly.

## Recommended Implementation Order

If only one file should be touched at a time, use this sequence:

1. `src/libraries/StepLib.sol`
2. `src/libraries/CurrencyLibrary.sol`
3. `src/libraries/ValueX7Lib.sol`
4. `src/StepStorage.sol`
5. `src/TokenCurrencyStorage.sol`
6. `src/CheckpointStorage.sol`
7. `src/BidStorage.sol`
8. `src/TickStorage.sol`
9. `src/ContinuousClearingAuction.sol`
10. `src/interfaces/`

This order front-loads the hardest compatibility blockers and leaves the main auction integration until the dependencies are under control.

## Highest-Risk Areas

Treat these as mandatory parity hotspots:

- step decoding and issuance timing
- checkpoint accounting
- partial fill computation
- refund logic
- graduation threshold behavior
- token and currency conservation

If the port differs in any of those, it is not functionally equivalent.

## Done Criteria

The STRATO port is only done when:

- the reduced core compiles
- no unsupported parser/runtime patterns remain
- the scenario matrix in `CCA_PARITY_PLAN.md` passes
- value conservation invariants hold
- the ported auction produces the same economically meaningful outcomes as the reduced original
