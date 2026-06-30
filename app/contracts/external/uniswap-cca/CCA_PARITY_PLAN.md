# CCA Parity Plan

This document defines how to verify that a STRATO port of the standalone Continuous Clearing Auction (CCA) core preserves the behavior of the reduced upstream source in this folder.

## Goal

Compilation is not enough. Parity means that for the same auction configuration and the same sequence of user actions, the original CCA and the STRATO port produce the same:

- state transitions
- balances and value flows
- bid outcomes
- checkpoint progression
- clearing prices
- final settlement results

## Scope

This plan applies to the reduced standalone CCA core kept in this folder:

- `src/ContinuousClearingAuction.sol`
- `src/BidStorage.sol`
- `src/CheckpointStorage.sol`
- `src/StepStorage.sol`
- `src/TickStorage.sol`
- `src/TokenCurrencyStorage.sol`
- supporting interfaces and libraries still referenced by those contracts

This plan does not cover:

- factory deployment helpers
- Uniswap v4 / LBP integration
- periphery validation hook examples
- lens helpers

## User-Facing Flow To Preserve

The port must preserve this business flow:

1. Auction creator configures the auction and transfers the sale tokens into the auction contract.
2. Bidders submit bids using `maxPrice`, `amount`, and `owner`.
3. The auction tracks demand across ticks and time-based issuance steps.
4. Checkpoints update clearing state and cumulative fill progress.
5. After the auction, bids are exited or partially exited according to fill status.
6. After claimability, bidders claim purchased tokens.
7. The auction sweeps raised currency to the funds recipient and unsold tokens to the tokens recipient.

## Verification Strategy

Parity should be verified in four layers:

1. Golden scenario tests
2. Differential state traces
3. Invariant checks
4. Boundary and error-path tests

The strongest signal comes from running the same scenario against:

- the reduced original CCA implementation
- the STRATO port

Then comparing the resulting state after every action.

## State Snapshot Schema

Capture the following values after every scenario step in both implementations:

- current block
- `clearingPrice`
- latest checkpoint block
- latest checkpoint clearing price
- latest checkpoint cumulative MPS
- `currencyRaised`
- `totalCleared`
- `sumCurrencyDemandAboveClearingQ96`
- `isGraduated`
- auction token balance
- auction currency balance
- funds recipient balance delta
- tokens recipient balance delta

For every touched bid, capture:

- bid id
- owner
- `maxPrice`
- `amount`
- `startBlock`
- `exitedBlock`
- `tokensFilled`
- claimable token amount
- refunded currency amount

## Scenario Matrix

### 1. Auction Setup, No Bids

Purpose:
- verify token receipt flow
- verify inactive and post-end behavior with zero demand

Actions:
1. Deploy auction with valid parameters.
2. Call `onTokensReceived()`.
3. Observe state before `startBlock`.
4. Advance to `endBlock`.
5. Finalize if needed.
6. Sweep unsold tokens.

Checks:
- tokens received state flips correctly
- no currency is raised
- no tokens are sold
- all sale tokens are recoverable by the tokens recipient
- no bidder-related state is created

### 2. Single Winning Bid

Purpose:
- verify the happy path for bid submission, checkpointing, exit, and claim

Actions:
1. Set up auction and fund tokens.
2. Submit one valid bid above floor.
3. Advance through auction completion.
4. Exit the bid.
5. Claim tokens.
6. Sweep raised currency.

Checks:
- bid is registered correctly
- clearing price updates correctly
- checkpoint values are correct
- claimed tokens and raised currency match expected values
- balances reconcile exactly

### 3. Multiple Bids At Increasing Prices

Purpose:
- verify tick ordering and demand accumulation across multiple price levels

Actions:
1. Submit several bids at ascending prices.
2. Trigger checkpoints during the auction.
3. Finalize the auction.
4. Exit and claim all bids.

Checks:
- ticks are inserted and traversed consistently
- clearing price progression matches the original
- final token allocations and refunds match exactly

### 4. Outbid Bid

Purpose:
- verify that a bid displaced by later demand exits correctly

Actions:
1. Submit an early bid.
2. Submit later demand at higher prices.
3. Finalize the auction.
4. Exit the earlier bid.

Checks:
- outbid bid receives correct refund
- fill amount is zero or partial exactly as in the original
- checkpoint hints remain valid

### 5. Partially Filled Bid

Purpose:
- verify the most sensitive settlement path

Actions:
1. Submit bids so one bid sits on the final clearing boundary.
2. Finalize the auction.
3. Call `exitPartiallyFilledBid(...)`.
4. Claim resulting tokens.

Checks:
- partial fill amount matches exactly
- refund amount matches exactly
- no token or currency is created or lost

### 6. Sold-Out Auction

Purpose:
- verify full sale of total supply

Actions:
1. Submit enough valid demand to fully clear the auction.
2. Finalize the auction.
3. Exit and claim all bids.
4. Sweep unsold tokens.

Checks:
- total sold equals total supply
- unsold token sweep yields zero
- no extra bids can clear beyond supply

### 7. Graduation Threshold Missed

Purpose:
- verify finalization behavior below `requiredCurrencyRaised`

Actions:
1. Configure threshold above final raised amount.
2. Run the auction to completion.
3. Observe final state and settlement paths.

Checks:
- `isGraduated` is false
- final state matches the original exactly

### 8. Graduation Threshold Hit Exactly

Purpose:
- verify the threshold boundary condition

Actions:
1. Configure bids to reach exactly `requiredCurrencyRaised`.
2. Finalize the auction.

Checks:
- `isGraduated` flips at the exact same threshold point as the original
- final state matches the original exactly

### 9. Batch Claim

Purpose:
- verify aggregation behavior for same-owner claims

Actions:
1. Create multiple exited bids for one owner.
2. Call `claimTokensBatch(owner, bidIds)`.

Checks:
- aggregate transferred amount equals the sum of individual claims
- per-bid claim state is updated correctly
- duplicate claims are prevented

### 10. Sweep Flows

Purpose:
- verify final value extraction paths

Actions:
1. Complete an auction with both raised currency and unsold tokens.
2. Call `sweepCurrency()`.
3. Call `sweepUnsoldTokens()`.

Checks:
- funds recipient receives correct raised currency
- tokens recipient receives correct unsold tokens
- repeated sweep attempts do not over-withdraw

## Error-Path Coverage

The port should also preserve revert behavior for these categories:

- bid before start block
- bid before tokens are received
- zero or invalid bid amount
- bid price below or at invalid boundary
- invalid owner address
- exit before allowed
- invalid partial-exit hints
- claim before claim block
- claim without exit when exit is required
- double exit
- double claim

Exact revert strings or custom error names may change during the STRATO port, but the rejection behavior and safety guarantees must remain equivalent.

## Invariants

These invariants should hold in both implementations for every scenario and any fuzzed variants:

- claimed tokens never exceed filled tokens
- sold tokens plus unsold tokens never exceed total supply
- refunded currency plus raised currency never exceeds total bid currency received
- clearing price never drops below floor price
- checkpoint block progression is monotonic
- exited bids cannot be exited twice
- claimed bids cannot be claimed twice
- sweep functions cannot extract more than remaining balances

## Differential Trace Format

For each scenario, record a trace with one row per action:

- action name
- caller
- function invoked
- inputs
- emitted events
- post-action state snapshot

Recommended actions to trace:

- deployment
- `onTokensReceived()`
- each `submitBid(...)`
- each `checkpoint()`
- each `exitBid(...)`
- each `exitPartiallyFilledBid(...)`
- each `claimTokens(...)`
- each `claimTokensBatch(...)`
- `sweepCurrency()`
- `sweepUnsoldTokens()`

## Pass Criteria

Do not claim functional parity until all of the following are true:

- all core scenarios pass on both implementations
- differential traces match on all economically meaningful state variables
- invariants hold across scenario and edge-path coverage
- partial-fill and graduation boundary cases match exactly
- no unresolved divergence remains in clearing price, token allocation, or refund math

## Recommended Execution Order

1. Write one deterministic golden scenario per core flow.
2. Build a state snapshot helper shared by both environments.
3. Compare original vs STRATO after every action.
4. Add boundary cases for partial fills and graduation.
5. Add invariant-oriented variations after deterministic parity is stable.

## Final Note

The port should be considered successful only when value movement and settlement behavior are provably equivalent, not merely when the contracts compile or superficially pass isolated unit tests.
