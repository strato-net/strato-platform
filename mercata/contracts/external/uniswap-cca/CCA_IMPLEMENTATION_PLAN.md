# CCA Implementation Plan

This document describes the implementation strategy for porting the reduced standalone Continuous Clearing Auction (CCA) core in this folder to STRATO.

It is complementary to:

- `CCA_PORT_EXECUTION_CHECKLIST.md`
- `CCA_PARITY_PLAN.md`

This document focuses on implementation sequencing, design intent, and the smallest viable milestones for getting from the reduced upstream baseline to a STRATO-compatible auction core.

## Objective

Port the reduced standalone CCA implementation to STRATO while preserving the original auction behavior:

- token funding
- bid submission
- clearing price progression
- checkpointing
- full and partial bid exits
- claims
- raised currency sweep
- unsold token sweep

The implementation does not need to preserve upstream gas-optimization techniques. It does need to preserve economically meaningful behavior.

## Starting Point

The current reduced source tree contains:

- `src/ContinuousClearingAuction.sol`
- `src/BidStorage.sol`
- `src/CheckpointStorage.sol`
- `src/StepStorage.sol`
- `src/TickStorage.sol`
- `src/TokenCurrencyStorage.sol`
- supporting libraries and interfaces
- a minimal vendored dependency subset for `solady` and `blocknumberish`

The code has already been reduced to the standalone auction core. Factory, v4, lens, periphery, and other non-core pieces have been removed.

## Known Porting Obstacles

The current reduced code still depends on patterns that do not work on STRATO as-is:

1. `$`-prefixed identifiers
2. user-defined value types
3. `using ... global`
4. inline assembly in core libraries
5. `ReentrancyGuardTransient`
6. `SSTORE2`
7. block-number helper logic tied to EVM-specific assumptions

These are implementation issues, not business-logic issues. The auction model itself appears portable.

## Design Approach

The port should favor:

- plain Solidity over assembly
- explicit types over clever wrappers
- ordinary storage over code-as-storage tricks
- simple safety guards over transient-opcode tricks
- incremental compile verification after each change

The goal is to make the code STRATO-friendly first, then verify parity. The goal is not to preserve the original micro-optimized source style.

## Business Logic To Preserve

The implementation must preserve this flow:

1. The auction is configured with a sale token, currency, recipients, floor price, timing, and supply schedule.
2. The auction receives the total supply of sale tokens.
3. Bidders place bids with a maximum price and amount.
4. Demand accumulates at ticks and the auction advances through issuance steps over time.
5. Checkpoints track cumulative sale progress and clearing conditions.
6. After the auction, bids are exited based on whether they were filled, partially filled, or outbid.
7. Bidders claim filled tokens.
8. The contract sweeps raised currency and unsold tokens to recipients.

If any of those outcomes drift, the port is not acceptable.

## Implementation Phases

### Phase 1: Parser Compatibility

Goal:
- remove the earliest parser blockers so deeper issues become visible

Primary changes:

- rename all `$...` identifiers to standard Solidity names
- remove or simplify any syntax forms STRATO rejects before semantic analysis

Primary files:

- `src/ContinuousClearingAuction.sol`
- `src/BidStorage.sol`
- `src/CheckpointStorage.sol`
- `src/StepStorage.sol`
- `src/TickStorage.sol`

Expected result:
- the compiler gets past the first parser-level failures

### Phase 2: Type Simplification

Goal:
- remove unsupported or high-friction abstractions

Primary changes:

- replace `Currency` with plain `address`
- replace `ValueX7` with plain `uint256`
- remove `using ... global`
- update all library and contract call sites

Primary files:

- `src/libraries/CurrencyLibrary.sol`
- `src/libraries/ValueX7Lib.sol`
- `src/TokenCurrencyStorage.sol`
- `src/CheckpointStorage.sol`
- `src/ContinuousClearingAuction.sol`
- relevant interfaces

Expected result:
- type-system friction is gone and the code becomes simpler to port file-by-file

### Phase 3: Remove Unsupported Low-Level Helpers

Goal:
- replace unsupported EVM-optimized helper implementations

Primary changes:

- rewrite `StepLib` without assembly
- rewrite `CurrencyLibrary` without assembly-heavy transfer code
- replace `ReentrancyGuardTransient` with a simple boolean-lock guard
- simplify `BlockNumberish` to a STRATO-safe block-number approach

Primary files:

- `src/libraries/StepLib.sol`
- `src/libraries/CurrencyLibrary.sol`
- `src/ContinuousClearingAuction.sol`
- `lib/blocknumberish/src/BlockNumberish.sol`
- `lib/solady/src/utils/ReentrancyGuardTransient.sol` or a local replacement

Expected result:
- all non-portable helper behavior is removed or isolated

### Phase 4: Replace `SSTORE2`-Based Step Storage

Goal:
- make issuance-step storage plain and STRATO-friendly

Primary changes:

- remove `SSTORE2`
- decode `auctionStepsData` once in the constructor
- store parsed steps in ordinary storage
- preserve step boundaries, iteration order, and issuance semantics

Primary files:

- `src/StepStorage.sol`
- `src/libraries/StepLib.sol`
- `src/interfaces/IStepStorage.sol`
- `lib/solady/src/utils/SSTORE2.sol` can eventually become unused

Expected result:
- the highest-risk storage portability issue is removed

### Phase 5: Rebuild Storage Layers

Goal:
- get the supporting storage contracts compiling on top of the simplified helpers

Primary changes:

- update `TokenCurrencyStorage` for plain `address` and plain `uint256`
- update `CheckpointStorage` for simplified `ValueX7`
- reconcile renamed fields and helper calls in `BidStorage` and `TickStorage`

Primary files:

- `src/TokenCurrencyStorage.sol`
- `src/CheckpointStorage.sol`
- `src/BidStorage.sol`
- `src/TickStorage.sol`
- support libraries those files require

Expected result:
- storage mixins compile cleanly on STRATO

### Phase 6: Rebuild the Main Auction

Goal:
- integrate the simplified helpers and storage layers into the main auction contract

Primary changes:

- update `ContinuousClearingAuction.sol` for:
  - renamed storage fields
  - simplified types
  - replacement reentrancy guard
  - simplified helper/library calls
- keep public entrypoints and event flow stable

Primary file:

- `src/ContinuousClearingAuction.sol`

Expected result:
- the standalone auction compiles on STRATO

### Phase 7: Interface Reconciliation

Goal:
- make interfaces accurately reflect the ported runtime behavior

Primary changes:

- update interface types to match concrete implementations
- keep externally visible behavior close to the reduced original
- avoid unnecessary API churn

Primary files:

- `src/interfaces/IContinuousClearingAuction.sol`
- `src/interfaces/IBidStorage.sol`
- `src/interfaces/ICheckpointStorage.sol`
- `src/interfaces/IStepStorage.sol`
- `src/interfaces/ITickStorage.sol`
- `src/interfaces/ITokenCurrencyStorage.sol`
- `src/interfaces/IValidationHook.sol`
- minimal external interfaces

Expected result:
- the ported contract surface is internally consistent

### Phase 8: Functional Verification

Goal:
- prove behavior, not just compile success

Primary changes:

- execute the scenarios in `CCA_PARITY_PLAN.md`
- compare traces against the reduced original implementation
- validate value conservation and settlement correctness

Expected result:
- the STRATO port is behaviorally credible

## Recommended File Order

For implementation, use this order:

1. `src/libraries/StepLib.sol`
2. `src/libraries/CurrencyLibrary.sol`
3. `src/libraries/ValueX7Lib.sol`
4. `src/StepStorage.sol`
5. `src/TokenCurrencyStorage.sol`
6. `src/CheckpointStorage.sol`
7. `src/BidStorage.sol`
8. `src/TickStorage.sol`
9. `src/ContinuousClearingAuction.sol`
10. interface reconciliation
11. parity verification

This order front-loads the most incompatible helper code and delays the main integration until the dependencies are simplified.

## First Milestone

The first meaningful milestone is:

- helper libraries compile
- `StepStorage` compiles without `SSTORE2`
- storage mixins compile
- `ContinuousClearingAuction.sol` compiles

This milestone does not prove parity, but it proves the port is structurally viable.

## Highest-Risk Areas

The riskiest parity areas are:

- step decoding and issuance timing
- checkpoint accounting
- partial fill calculations
- refund logic
- graduation threshold behavior
- clearing price progression
- token and currency conservation

Any changes in these areas must be checked against the original using the parity plan.

## What Not To Optimize Early

Do not spend early cycles trying to preserve:

- gas-optimized assembly
- compact custom type wrappers
- clever storage tricks
- upstream code style fidelity

Those details are lower priority than:

- parseability
- compile success
- behavioral correctness

## Acceptance Criteria

The implementation is only complete when:

- the reduced standalone CCA core compiles on STRATO
- no unsupported implementation patterns remain in the runtime path
- the scenario matrix in `CCA_PARITY_PLAN.md` passes
- settlement and balance outcomes match the reduced original implementation

## Immediate Next Step

The first implementation slice should focus on:

- `src/libraries/StepLib.sol`
- `src/libraries/CurrencyLibrary.sol`
- `src/StepStorage.sol`
- `src/ContinuousClearingAuction.sol`

Those files currently concentrate the most visible STRATO incompatibilities and will determine whether the rest of the port proceeds cleanly.
