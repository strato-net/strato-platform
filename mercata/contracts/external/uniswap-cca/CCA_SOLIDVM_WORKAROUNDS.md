# CCA SolidVM Workarounds

This document records the full set of STRATO SolidVM issues encountered while porting the reduced Uniswap Continuous Clearing Auction (CCA) core, along with the concrete workaround used in the port.

It is intentionally implementation-focused:

- what SolidVM rejected or handled differently
- where it showed up in the reduced CCA code
- how the port was changed to get past it

## Summary

The port succeeded, but not by preserving the upstream source shape. The STRATO-compatible version required systematic simplification:

- parser-oriented syntax cleanup
- removal of unsupported type abstractions
- replacement of EVM-specific low-level helpers
- replacement of storage/code tricks with ordinary Solidity storage
- flattening of interface and library call patterns that SolidVM did not resolve reliably

## Full Workaround List

### 1. `$`-prefixed identifiers were rejected by the parser

Observed behavior:

- `solid-vm-cli` rejected identifiers like `$clearingPrice`, `$_tokensReceived`, and similar storage/local names.

Workaround:

- renamed all `$...` identifiers to ordinary Solidity names such as `_clearingPrice`, `_tokensReceived`, `_lastCheckpointedBlock`, `_bids`, `_ticks`

Primary files:

- `src/ContinuousClearingAuction.sol`
- `src/StepStorage.sol`
- `src/CheckpointStorage.sol`
- `src/BidStorage.sol`
- `src/TickStorage.sol`

### 2. User-defined value types were not viable in the ported runtime

Observed behavior:

- `type Currency is address;`
- `type ValueX7 is uint256;`
- related `wrap(...)` / `unwrap(...)` usage

caused SolidVM friction and blocked compilation.

Workaround:

- replaced `Currency` with plain `address`
- replaced `ValueX7` with plain `uint256`
- preserved semantic suffixes like `_Q96_X7` in variable names where useful

Primary files:

- `src/libraries/CurrencyLibrary.sol`
- `src/libraries/ValueX7Lib.sol`
- `src/TokenCurrencyStorage.sol`
- `src/CheckpointStorage.sol`
- `src/ContinuousClearingAuction.sol`
- relevant interfaces

### 3. `using ... global` was rejected

Observed behavior:

- SolidVM rejected global library attachment patterns such as `using CurrencyLibrary for Currency global;`

Workaround:

- removed `using ... global`
- converted call sites either to ordinary `using` in contract scope or to explicit library function calls

Primary files:

- `src/libraries/CurrencyLibrary.sol`
- `src/libraries/ValueX7Lib.sol`

### 4. Self-`using` patterns could trigger hangs or compiler confusion

Observed behavior:

- patterns like `using StepLib for *;` or `using BidLib for *;` inside the same library were unnecessary and, in practice, correlated with problematic SolidVM behavior

Workaround:

- removed self-`using` declarations
- replaced extension-style self-calls with direct function calls where needed

Primary files:

- `src/libraries/StepLib.sol`
- `src/libraries/BidLib.sol`

### 5. Inline assembly in helper libraries was not portable

Observed behavior:

- assembly blocks in the original helper path either failed outright or were not safe to carry forward on STRATO

Workaround:

- rewrote packed step parsing in plain Solidity
- removed assembly-heavy paths from helper code instead of trying to preserve byte-for-byte EVM tricks

Primary files:

- `src/libraries/StepLib.sol`
- `src/libraries/CurrencyLibrary.sol`

### 6. Native-currency transfer helpers were not usable as written

Observed behavior:

- attempts using `address.transfer`, `address.balance`, `send`, inline `call`, and `account(...)`-style rewrites did not produce a clean, portable solution in the CCA runtime path

Workaround:

- simplified `CurrencyLibrary` so ERC20 transfers are direct and explicit
- moved away from trying to preserve a native-transfer path in the main auction flow
- the current STRATO port explicitly disables native bid submission

Primary files:

- `src/libraries/CurrencyLibrary.sol`
- `src/TokenCurrencyStorage.sol`
- `src/ContinuousClearingAuction.sol`

### 7. Native `msg.value` bid flow was not retained

Observed behavior:

- the upstream contract allowed native-currency bidding when `currency == address(0)`
- the STRATO port could not keep that runtime path in a clean SolidVM-compatible form

Workaround:

- `submitBid(...)` now rejects native-currency bids explicitly
- ERC20 bidding remains supported

Primary files:

- `src/ContinuousClearingAuction.sol`
- `src/interfaces/IContinuousClearingAuction.sol`

Behavior note:

- this is the clearest intentional runtime deviation from upstream behavior in the current compile-complete port

### 8. `ReentrancyGuardTransient` was incompatible

Observed behavior:

- the upstream guard depended on transient-storage behavior and low-level implementation details not suitable for the SolidVM port

Workaround:

- replaced it with a simple boolean reentrancy lock

Primary files:

- `lib/solady/src/utils/ReentrancyGuardTransient.sol`
- `src/ContinuousClearingAuction.sol`

### 9. `SSTORE2`-based step storage had to be removed

Observed behavior:

- upstream step storage relied on code-as-storage via `SSTORE2`, which was not an acceptable STRATO storage strategy for this port

Workaround:

- removed the pointer-based step storage model
- decoded `auctionStepsData` once in the constructor
- stored parsed steps in an ordinary storage array
- preserved issuance-step sequencing through indexed storage iteration

Primary files:

- `src/StepStorage.sol`
- `src/interfaces/IStepStorage.sol`

### 10. Vendored import resolution was unreliable

Observed behavior:

- package-style or parent-relative imports into vendored helper code were not consistently resolved by `solid-vm-cli`

Evidence:

- a root-level compile test was run from `mercata/contracts/external/uniswap-cca` using:
  - `solid-vm-cli compile "src/ContinuousClearingAuction.sol"`
- after temporarily restoring an original-style vendored import:
  - `import {FixedPointMathLib} from 'solady/utils/FixedPointMathLib.sol';`
- `solid-vm-cli` still failed to resolve the import and reported:
  - `Could not find file by name of src/solady/utils/FixedPointMathLib.sol`

Interpretation:

- this issue is not explained only by running the compiler from inside `src/`
- it appears to be a real toolchain / import-resolution problem in `solid-vm-cli`

Workaround:

- avoided depending on those imports in the main runtime path
- replaced affected helper calls with local functions or inlined logic

Primary files:

- `src/ContinuousClearingAuction.sol`
- `src/libraries/CheckpointAccountingLib.sol`
- `src/libraries/MaxBidPriceLib.sol`

### 11. `type(...).max` style expressions were not accepted reliably

Observed behavior:

- expressions like `type(uint256).max`, `type(uint64).max`, `type(uint160).max`, `type(uint32).max` surfaced as compiler problems

Workaround:

- replaced them with explicit numeric expressions such as:
  - `(2 ** 256) - 1`
  - `uint64((2 ** 64) - 1)`
  - `(2 ** 160) - 1`
  - `((2 ** 32) - 1) + 1`

Primary files:

- `src/libraries/ConstantsLib.sol`
- `src/libraries/MaxBidPriceLib.sol`
- `src/TickStorage.sol`
- `src/CheckpointStorage.sol`

### 12. Named mapping syntax was rejected

Observed behavior:

- SolidVM rejected mapping declarations that used named key/value labels like:
  - `mapping(uint256 bidId => Bid bid)`
  - `mapping(uint256 price => Tick)`
  - `mapping(uint64 blockNumber => Checkpoint)`

Workaround:

- replaced them with plain mappings:
  - `mapping(uint256 => Bid)`
  - `mapping(uint256 => Tick)`
  - `mapping(uint64 => Checkpoint)`

Primary files:

- `src/BidStorage.sol`
- `src/TickStorage.sol`
- `src/CheckpointStorage.sol`

### 13. Named-field struct literals were not reliable

Observed behavior:

- SolidVM produced type/order issues for the named memory literal used to build `Bid`

Workaround:

- replaced the named-field literal with explicit field assignments on a memory struct variable

Primary files:

- `src/BidStorage.sol`

### 14. Extension-style library calls on imported structs were unreliable

Observed behavior:

- calls like:
  - `bid.toEffectiveAmount()`
  - `bid.mpsRemainingInAuctionAfterSubmission()`
  - `_checkpoint.remainingMpsInAuction()`
  - `VALIDATION_HOOK.handleValidate(...)`

either failed or contributed to unstable compile behavior

Workaround:

- replaced them with direct library calls or local wrapper helpers:
  - `BidLib.toEffectiveAmount(bid)`
  - `BidLib.mpsRemainingInAuctionAfterSubmission(bid)`
  - `CheckpointLib.remainingMpsInAuction(checkpoint_)`
  - direct guarded `VALIDATION_HOOK.validate(...)`

Primary files:

- `src/ContinuousClearingAuction.sol`
- `src/libraries/BidLib.sol`
- `src/libraries/CheckpointAccountingLib.sol`

### 15. Interface-declared custom errors were not consistently resolved in implementations

Observed behavior:

- many contracts could compile their interfaces, but implementation files would still fail to resolve inherited custom errors cleanly

Workaround:

- replaced many internal reverts with explicit `require(...)` or string reverts in implementation code
- kept interface custom error declarations where useful to preserve surface familiarity, even if the implementation no longer emits all of them directly

Primary files:

- `src/StepStorage.sol`
- `src/TokenCurrencyStorage.sol`
- `src/TickStorage.sol`
- `src/CheckpointStorage.sol`
- `src/BidStorage.sol`
- `src/ContinuousClearingAuction.sol`

### 16. Missing `override` markers were enforced aggressively

Observed behavior:

- SolidVM required explicit `override` on implementing functions across storage mixins and the main contract

Workaround:

- added the required `override` markers on interface implementations

Primary files:

- `src/StepStorage.sol`
- `src/TickStorage.sol`
- `src/CheckpointStorage.sol`
- `src/BidStorage.sol`
- `src/ContinuousClearingAuction.sol`

### 17. Solady math dependencies had to be removed from the runtime path

Observed behavior:

- `FixedPointMathLib` was not a practical dependency to preserve in the reduced STRATO runtime path

Workaround:

- replaced usages with local helpers for:
  - min
  - max
  - saturating subtraction
  - divide-round-up
  - multiply-divide-round-up

Primary files:

- `src/libraries/CheckpointAccountingLib.sol`
- `src/libraries/MaxBidPriceLib.sol`
- `src/ContinuousClearingAuction.sol`

### 18. `StepLib` needed an explicit low-40-bit mask at runtime

Observed behavior:

- during Phase 8 smoke testing, `StepLib.get(...)` decoded `blockDelta` incorrectly under SolidVM test execution
- `uint40(packedValue)` behaved as if the upper bits were not truncated, and the decoded `blockDelta` came back as the full packed 64-bit word instead of the low 40 bits

Evidence:

- a smoke test decoded the packed schedule bytes and reported:
  - `decoded block delta mismatch: 5497558138880000002`
- that value corresponds to the full packed step word rather than the intended `blockDelta`

Workaround:

- changed `StepLib.get(...)` from:
  - `blockDelta = uint40(packedValue);`
- to:
  - `blockDelta = uint40(packedValue & ((uint64(1) << 40) - 1));`

Primary files:

- `src/libraries/StepLib.sol`
- `tests/CCA/CCAParitySmoke.test.sol`

Behavior note:

- this is runtime-relevant because it affects step decoding and therefore auction timing

### 19. ERC20 interface-method dispatch was unreliable in CCA runtime execution

Observed behavior:

- during Phase 8 smoke testing, interface-typed ERC20 calls inside the CCA runtime failed under the SolidVM test runner
- both `IERC20Minimal(...).balanceOf(...)` and `IERC20(...).balanceOf(...)` forms still produced type/runtime errors when executed through the auction

Evidence:

- `onTokensReceived()` failed with errors of the form:
  - `argument type mismatch in 'balanceOf': Argument 1: got Contract("IERC20Minimal"), expected address`
  - and later:
  - `argument type mismatch in 'balanceOf': Argument 1: got Contract("IERC20"), expected address`

Workaround:

- replaced key token/currency runtime calls in the auction path with low-level `address(...).call(...)` forms for:
  - token `balanceOf`
  - token `transfer`
  - currency `transferFrom`
  - currency `transfer`

Primary files:

- `src/ContinuousClearingAuction.sol`
- `src/TokenCurrencyStorage.sol`

Behavior note:

- this looks like a SolidVM runtime or execution-environment quirk rather than ordinary Solidity behavior

### 20. Permit2 / `SafeTransferLib` flow was removed

Observed behavior:

- the upstream runtime path used `SafeTransferLib.permit2TransferFrom(...)`
- that dependency path was not appropriate to preserve in the SolidVM port

Workaround:

- added `transferFrom(...)` to `IERC20Minimal`
- replaced permit2-based collection with direct ERC20 `transferFrom(...)`

Primary files:

- `src/interfaces/external/IERC20Minimal.sol`
- `src/ContinuousClearingAuction.sol`

### 21. Block-number helper indirection was unnecessary and not worth preserving

Observed behavior:

- the original helper path carried EVM-specific assumptions for block-numberish behavior

Workaround:

- simplified the helper layer to use `block.number`
- in the main auction, added a local `_getBlockNumberish()` helper that directly returns `block.number`

Primary files:

- `lib/blocknumberish/src/BlockNumberish.sol`
- `src/ContinuousClearingAuction.sol`

### 22. Full compile success required a flatter, more explicit source style overall

Observed behavior:

- even when a construct was theoretically valid Solidity, SolidVM compilation was more reliable when the code was rewritten in a simpler and more explicit form

Workaround:

- favored:
  - direct library calls over extension dispatch
  - plain storage over clever encoding tricks
  - plain integer math over imported helpers
  - explicit `require(...)` checks over inherited custom-error reuse
  - local helper functions over fragile dependency imports

## Current State After Workarounds

After the workarounds above:

- the reduced CCA `src/` tree compiles file-by-file under `solid-vm-cli`
- `ContinuousClearingAuction.sol` compiles on STRATO
- the reduced interface set compiles
- the main known behavioral deviation is the disabled native-currency bid path

## Remaining Risk

Compile success does not prove parity.

The highest remaining risk areas are still:

- step decoding and issuance timing
- checkpoint accounting
- partial-fill accounting
- refund behavior
- graduation threshold behavior
- raised currency and unsold token sweep behavior

Those are Phase 8 / parity-validation concerns, not remaining compile blockers.
