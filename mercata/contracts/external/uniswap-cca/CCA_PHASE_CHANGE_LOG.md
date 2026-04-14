# CCA Phase Change Log

This document records the concrete source changes made during each STRATO porting phase for the reduced standalone CCA core.

It is intended to answer:

- what changed in this phase
- which files were touched
- what was verified
- what blockers remain before the next phase

Use this together with:

- `CCA_IMPLEMENTATION_PLAN.md`
- `CCA_PORT_EXECUTION_CHECKLIST.md`
- `CCA_PARITY_PLAN.md`

## Phase 1: Parser Compatibility

### Goal

Remove the earliest STRATO parser blocker caused by `$`-prefixed identifiers in the reduced core contracts.

### Files Changed

- `src/ContinuousClearingAuction.sol`
- `src/StepStorage.sol`
- `src/CheckpointStorage.sol`
- `src/BidStorage.sol`
- `src/TickStorage.sol`

### Changes Made

- Renamed all `$...` and `$_...` state/storage identifiers to standard internal names.
- Updated all references in the main auction contract to use the renamed inherited fields.
- Kept logic unchanged; this was a syntax-compatibility pass only.

### Representative Renames

- `$clearingPrice` -> `_clearingPrice`
- `$_tokensReceived` -> `_tokensReceived`
- `$lastCheckpointedBlock` -> `_lastCheckpointedBlock`
- `$_bids` -> `_bids`
- `$_checkpoints` -> `_checkpoints`
- `$nextActiveTickPrice` -> `_nextActiveTickPrice`
- `$step` -> `_step`

### Verification

- No `$` identifiers remained anywhere in the reduced `src/` tree after the pass.
- Lint checks on the edited files returned no issues.
- The previous `unexpected '$'` compiler failure was eliminated.

### Result

Phase 1 exposed the next real blockers:

- import-resolution issues in `solid-vm-cli`
- deeper incompatibilities that had been hidden behind the parser failure

## Phase 2: Type Simplification

### Goal

Remove unsupported type abstractions from the reduced core by replacing `Currency` and `ValueX7` with plain Solidity types.

### Files Changed

- `src/libraries/CurrencyLibrary.sol`
- `src/libraries/ValueX7Lib.sol`
- `src/libraries/CheckpointLib.sol`
- `src/libraries/CheckpointAccountingLib.sol`
- `src/TokenCurrencyStorage.sol`
- `src/CheckpointStorage.sol`
- `src/interfaces/IContinuousClearingAuction.sol`
- `src/interfaces/ITokenCurrencyStorage.sol`
- `src/ContinuousClearingAuction.sol`

### Changes Made

- Replaced `Currency` with plain `address`.
- Replaced `ValueX7` with plain `uint256`.
- Removed `Currency.wrap(...)` and `Currency.unwrap(...)` usage.
- Removed `ValueX7.wrap(...)` and `ValueX7.unwrap(...)` usage.
- Removed the unsupported `using ... global` pattern from the runtime path.
- Updated checkpoint accounting and interface return types to use `uint256`.
- Preserved `_X7` suffixes and variable names so the accounting meaning remains clear.

### Examples

- `Currency internal immutable CURRENCY` -> `address internal immutable CURRENCY`
- `ValueX7 internal _currencyRaisedQ96_X7` -> `uint256 internal _currencyRaisedQ96_X7`
- `function currencyRaisedQ96_X7() external view returns (ValueX7)` -> `returns (uint256)`

### Verification

- No remaining `Currency` or `ValueX7` type usage remained in the reduced runtime source, outside of comment text.
- Lint checks on the edited files returned no issues.
- The next compiler failure moved on from type-abstraction issues to lower-level helper incompatibilities.

### Result

Phase 2 exposed the next blockers:

- assembly-heavy logic in `CurrencyLibrary.sol`
- assembly-heavy logic in `StepLib.sol`
- `ReentrancyGuardTransient`
- remaining `solid-vm-cli` import-resolution quirks

## Phase 3

### Goal

Remove unsupported low-level helper implementations and replace them with STRATO-friendly logic.

### Files Changed

- `src/libraries/StepLib.sol`
- `src/libraries/CurrencyLibrary.sol`
- `src/libraries/ValueX7Lib.sol`
- `lib/blocknumberish/src/BlockNumberish.sol`
- `lib/solady/src/utils/ReentrancyGuardTransient.sol`

### Changes Made

- Rewrote `StepLib.get(...)` to remove the original packed-word assembly logic.
- Simplified `BlockNumberish` to use `block.number` directly and return `0` for flashblock lookups.
- Replaced the transient-storage reentrancy guard implementation with a simple boolean lock while preserving the same modifier names.
- Removed the `FixedPointMathLib` dependency from `ValueX7Lib` by replacing `saturatingSub` with plain Solidity.
- Attempted to rewrite `CurrencyLibrary` away from the original assembly-heavy implementation while keeping ERC20 transfers straightforward.

### Verification

- `src/libraries/StepLib.sol` compiles under `solid-vm-cli`.
- `src/libraries/CurrencyLibrary.sol` compiles under `solid-vm-cli`.
- `lib/blocknumberish/src/BlockNumberish.sol` compiles under `solid-vm-cli`.
- `lib/solady/src/utils/ReentrancyGuardTransient.sol` compiles under `solid-vm-cli`.
- `src/libraries/ConstantsLib.sol` compiles under `solid-vm-cli`.
- `src/TokenCurrencyStorage.sol` compiles under `solid-vm-cli`.
- Lint checks on the edited helper files returned no issues.

### Result

Phase 3 is complete. The reduced helper surface has been rewritten into a STRATO-parseable form:

- `StepLib` no longer uses the original assembly parser logic
- `CurrencyLibrary` no longer depends on the original runtime-heavy assembly implementation
- `BlockNumberish` now uses `block.number`
- `ReentrancyGuardTransient` is now a simple boolean lock
- `ConstantsLib` no longer depends on `type(...)`
- `TokenCurrencyStorage` now compiles against the simplified helper surface

### Status

Complete.

## Phase 4

### Goal

Replace `SSTORE2`-based step storage with plain storage while preserving step decoding and issuance timing.

### Files Changed

- `src/StepStorage.sol`

### Changes Made

- Removed the `SSTORE2` import and pointer-based storage model.
- Added a plain storage array of decoded auction step inputs.
- Decoded `auctionStepsData` once in the constructor and stored `mps` / `blockDelta` pairs directly.
- Replaced bytecode-backed step reads with indexed storage access.
- Kept the current active step in `_step` and advanced it using `_nextStepIndex`.
- Made `pointer()` return `address(0)` because the code-as-storage model no longer exists in the STRATO port.
- Flattened SolidVM complaints around interface errors and extension syntax so the rewritten storage layer would compile cleanly.

### Verification

- `src/StepStorage.sol` compiles under `solid-vm-cli`.
- Lint checks on the rewritten file returned no issues.

### Result

Phase 4 is complete. The auction step schedule now lives in ordinary contract storage rather than a bytecode pointer contract.

### Status

Complete.

## Phase 5

### Planned Goal

Rebuild the supporting storage layers on top of the simplified helper surface.

### Files Changed

- `src/BidStorage.sol`
- `src/TickStorage.sol`
- `src/CheckpointStorage.sol`
- `src/libraries/BidLib.sol`
- `src/libraries/CheckpointAccountingLib.sol`

### Changes Made

- Replaced named mapping syntax with plain `mapping(key => value)` declarations accepted by SolidVM.
- Replaced `type(...).max` usage in storage constants with explicit numeric expressions.
- Flattened interface-declared custom error usage into explicit `require(...)` checks where SolidVM would not resolve inherited errors.
- Added missing `override` markers on interface getter implementations.
- Removed another self-`using` pattern from `BidLib`.
- Replaced extension-method dispatch on `Bid` structs with direct library calls.
- Replaced the named-field `Bid({...})` memory literal with explicit field assignments.
- Removed the remaining `FixedPointMathLib` dependency from checkpoint accounting and inlined a minimal `_mulDiv` helper.

### Verification

- `src/BidStorage.sol` compiles under `solid-vm-cli`.
- `src/TickStorage.sol` compiles under `solid-vm-cli`.
- `src/CheckpointStorage.sol` compiles under `solid-vm-cli`.
- `src/libraries/BidLib.sol` compiles under `solid-vm-cli`.
- `src/libraries/CheckpointAccountingLib.sol` compiles under `solid-vm-cli`.
- Lint checks on the edited Phase 5 files returned no issues.

### Result

Phase 5 is complete. The core storage and accounting mixins now compile on STRATO after removing several parser-specific patterns and one remaining solady math dependency.

### Status

Complete.

## Phase 6

### Planned Goal

Rebuild the main auction contract on top of the ported helpers and storage layers.

### Files Changed

- `src/ContinuousClearingAuction.sol`
- `src/interfaces/external/IERC20Minimal.sol`

### Changes Made

- Removed the remaining dependency on external helper imports inside `ContinuousClearingAuction.sol` and replaced them with local STRATO-compatible helpers for block number, min/max, division-round-up, and saturating subtraction.
- Replaced extension-method dispatch on `Checkpoint` and `Bid` with direct library calls or local helper wrappers.
- Replaced the validation-hook extension call with a direct guarded `validate(...)` invocation.
- Flattened the remaining interface-error/parser issues in the main contract by converting a number of unresolved custom-error reverts to explicit `require(...)` / string reverts.
- Added the missing `override` markers across the public auction API.
- Added `transferFrom(...)` to `IERC20Minimal` and replaced the removed `SafeTransferLib.permit2TransferFrom(...)` path with a direct ERC20 transfer flow.
- Disabled native-currency bid submission in the STRATO port. If `CURRENCY == address(0)`, bid entry now reverts explicitly instead of attempting to use `msg.value`.

### Verification

- `src/ContinuousClearingAuction.sol` compiles under `solid-vm-cli`.
- `src/interfaces/IContinuousClearingAuction.sol` compiles under `solid-vm-cli`.
- Lint checks on the edited Phase 6 files returned no issues.

### Result

Phase 6 is complete. The reduced auction core now compiles end-to-end on STRATO with the helper and storage rewrites in place.

### Status

Complete.

## Phase 7

### Planned Goal

Reconcile interfaces and prepare the ported core for parity validation.

### Files Changed

- `src/interfaces/IContinuousClearingAuction.sol`
- `src/interfaces/IStepStorage.sol`
- `CCA_SOLIDVM_WORKAROUNDS.md`

### Changes Made

- Updated interface documentation to reflect the current STRATO runtime behavior more accurately.
- Documented the intentional native-currency deviation: `currency == address(0)` remains representable in config, but native bid submission is currently rejected in the STRATO port.
- Updated the `IStepStorage.pointer()` documentation to reflect that the getter is now compatibility-only after the `SSTORE2` removal and returns `address(0)`.
- Added a dedicated `CCA_SOLIDVM_WORKAROUNDS.md` file with the consolidated list of SolidVM compiler/runtime issues and the concrete workaround used for each one.

### Verification

- A compile sweep over the full reduced `src/` tree succeeded under `solid-vm-cli`, including:
  - top-level contracts
  - supporting libraries
  - internal interfaces
  - minimal external interfaces
- `solid-vm-cli compile "interfaces/IContinuousClearingAuction.sol"` succeeds after the interface reconciliation updates.

### Result

Phase 7 is complete. The reduced CCA source tree is now internally consistent, fully compile-clean under SolidVM, and accompanied by an explicit record of the STRATO-specific workarounds applied during the port.

### Status

Complete.

## Notes

This file should be updated at the end of each implementation phase before moving to the next one.

## Phase 8

### Planned Goal

Execute parity validation scenarios and collect runtime evidence for the STRATO port.

### Files Changed

- `tests/CCA/CCAParitySmoke.test.sol`
- `src/libraries/StepLib.sol`
- `src/ContinuousClearingAuction.sol`
- `src/TokenCurrencyStorage.sol`
- `CCA_SOLIDVM_WORKAROUNDS.md`

### Changes Made

- Added an initial CCA smoke-test file to start Phase 8 with executable scenario coverage.
- Validated a no-bid setup path far enough to confirm:
  - token receipt succeeds
  - zero-demand state reads are stable
  - sale tokens remain in the auction prior to finalization
- Used the smoke tests to uncover a real `StepLib` runtime issue under SolidVM execution: `blockDelta` needed an explicit low-40-bit mask rather than a plain `uint40(...)` cast.
- Used the smoke tests to uncover ERC20 runtime call issues inside the auction path and rewired key token/currency calls to lower-level `address(...).call(...)` forms.
- Recorded both new findings in `CCA_SOLIDVM_WORKAROUNDS.md`.

### Verification

- `solid-vm-cli test "tests/CCA/CCAParitySmoke.test.sol"` now gets partway through runtime execution rather than failing at construction or token-receipt setup.
- Current passing smoke assertions:
  - `aa receives tokens`
  - `ab has zero raised currency without bids`
  - `ac keeps all sale tokens before finalization`

### Current Blockers

- The current SolidVM test harness does not yet provide a clean way to advance `block.number`, which limits direct execution of after-end settlement scenarios for a contract that now keys off `block.number`.
- The live-bid smoke path still has unresolved behavior around bid submission / state persistence, so the full scenario matrix in `CCA_PARITY_PLAN.md` is not yet complete.

### Result

Phase 8 is in progress. It has already produced useful runtime evidence and uncovered two additional SolidVM execution quirks, but parity validation is not complete yet.

### Status

In progress.
