# Consensus

STRATO orders blocks with PBFT, implemented as **Blockstanbul** (`strato/core/blockstanbul`), a variant of Istanbul BFT. Blockstanbul runs inside each node's `strato-sequencer`.

The validators come from the `MercataGovernance` contract. On networks where staking is active, their stake decides who proposes and how much each vote counts.

This page describes behavior on `develop`. For the design rationale, see:

- [Staking consensus design](../design-docs/staking-consensus.md)
- [Staking Phase 2 design decisions](../design-docs/staking-phase-2-design-decisions.md)

## PBFT round

Every block height goes through a *view*, which is the pair (sequence number, round).

1. **Preprepare.** The proposer for the view broadcasts a `PREPREPARE` message carrying the block.
2. **Prepare.** Validators check the proposal and broadcast `PREPARE` with the block hash.
3. **Commit.** Once the proposal gathers a prepare quorum, validators broadcast `COMMIT` with a commit seal, which is their signature.
4. **Finalize.** With a commit quorum, the block is committed, and every node executes and indexes it.

A **quorum** means that the voters' weight satisfies `3 × voters > 2 × total`.

- **Before staking is active,** or while no validator has stake, each validator weighs 1, so the quorum is a headcount.
- **Once staking is active,** each validator weighs its stake. Validators with zero stake count on neither side.

### Round changes

A round advances only when a proposal doesn't arrive or is rejected:

- **Watchdog.** A voting validator that isn't the proposer starts a watchdog when a pending block arrives. If no proposal lands within 2 seconds, and then every 5 seconds after that, it requests a round change.
- **Quorum.** Validators move to the new round once a quorum signs `ROUNDCHANGE`.
- **Backstop.** `--blockstanbul_round_period_s` (default 3600) forces a round change after that long without progress. In practice the watchdog acts first.

Rounds persist across heights: committing a block advances the sequence number but leaves the round unchanged. A high round number is not a health problem by itself.

### Block timing

`--blockstanbul_block_period_ms` (default 1000) is the minimum delay between block creations. After a block commits, a node paces its execution to the block period, but never waits longer than one block period regardless of the header timestamp.

### Block timestamps

The proposer stamps a block with its own clock, and `block.timestamp` in contracts reads that header field. The stamp is checked in three places:

- **Proposer.** A block is never stamped before its parent, even when the parent's proposer ran ahead of the local clock.
- **Vote time.** A validator refuses to vote for a proposal stamped more than `maxTimestampDriftS` seconds (default 15) ahead of its own clock, and requests a round change instead. This is local policy: it never applies to committed blocks, so nodes with different values do not fork. Set it in `ethconf.yaml` or with `--blockstanbul_max_timestamp_drift_s` at setup.
- **Verification.** A block whose timestamp precedes its parent's fails verification on every node, during the vote and during sync alike. Timestamps have one-second resolution, so consecutive blocks may share a second.

## Validator set

The validator set lives in `MercataGovernance`. It is a proxy at `0x100`, and genesis seeds it with the network's initial validators.

The node follows the contract's events:

| Event | Effect |
|---|---|
| `ValidatorAdded`, `ValidatorRemoved` | Change the set |
| `ValidatorStakeUpdated(validator, stake)` | Change a validator's weight |

The proposer records set changes (and, with staking, the stake weights) in the block header. Every other node re-derives them and rejects a block whose header disagrees. Changes take effect from the next block.

A validator is identified by its **node address**: the address of the node's key in the Vault (`nodeAddress` in `/health`).

There are two ways to change the set.

### Admin vote

Registered admins call `voteToAddValidator(address)` or `voteToRemoveValidator(address)`. A change passes once it has `floor(2 × admins / 3) + 1` votes. Admins are added and removed the same way, with `voteToAddAdmin` and `voteToRemoveAdmin`.

At genesis, `MercataGovernance` is owned by `AdminRegistry` (`0x100c`), which is also its only admin. Votes are therefore carried out through `AdminRegistry` governance.

### Staking

With staking wired to governance, the staking contract manages validators directly:

- `addValidatorFromStaking`
- `updateValidatorStake`
- `removeValidatorFromStaking`

The contract never removes the last validator, and `hardCapValidators` bounds the size of the set.

An operator joins in three steps:

1. **Register** in `ValidatorRegistry`, binding the node's validator address. Registration is permissionless.
2. **Bond** stake: self-bond plus delegated stake must reach `minStake`, a governance parameter.
3. **Activate** with `StratoStaking.tryActivate`. This needs a free slot, or enough stake to evict the lowest-weighted validator by a margin. While joins are paused, only the owner can activate operators.

An active operator leaves automatically, in the same transaction, as soon as it stops being eligible. Reasons include:

- falling below `minStake`
- being jailed
- reaching the end of an exit notice
- being removed by the owner

An operator that holds more than one third of the total stake can be removed with an emergency kick.

## Staking phases

| Phase | Contracts | Consensus effect |
|---|---|---|
| Phase 1 (17.5) | `StratoStaking`, `ValidatorRegistry` | None. Stake, delegation, rewards and unbonding are bookkeeping. |
| V2 (18.5) | `StratoStakingV2`, `ValidatorRegistryV2` (behind proxies), `FeeRouter`, `MercataGovernance` V2 | Stake drives consensus from the activation height |

From the staking activation height, V2 changes consensus in four ways:

- **Block header.** `BlockHeaderV3` adds the proposal round, the current stake weights and stake updates to the header.
- **Proposer selection.** The proposer is chosen deterministically, weighted by stake (see below).
- **Votes.** Prepare, commit and round-change votes are weighted by stake.
- **Liveness accounting.** The staking contract counts blocks proposed and missed proposals per validator, and emits `ProposalMissed`. After too many consecutive misses, it can jail a validator temporarily: the validator is removed from the set with its stake untouched. There is no slashing.

The activation height is a per-network setting, and every node must agree on it (see [Networks](networks.md#fork-heights)).

### Proposer selection

**Before activation,** the proposer is `validators[round mod n]`, taken over the validator set sorted by address. Because rounds persist, the proposer stays the same across heights until a round change.

**After activation,** `selectProposer` (`strato/core/strato-model/src/Blockchain/Strato/Model/ProposerSelection.hs`) picks the proposer for each height and round:

1. **Seed.** It computes `seed = keccak256(chainId ‖ height ‖ round)`. The seed contains nothing the previous proposer can choose.
2. **Weighted pick.** It walks the validators in address order, each weighted by stake, and picks at `seed mod totalStake`. If no validator has stake, the pick is uniform.
3. **Exclusion.** Validators already picked for earlier rounds at the same height are skipped, so a round change always moves to a different validator.

Contracts see facts about the parent block through these values:

- `block.prevProposer`
- `block.prevIntendedProposer`
- `block.prevRound`

`block.proposer` is the current block's proposer.

## Fees and block rewards

Every transaction pays a fee through the Decider (`0xDEC1DE`). The Decider runs the fee implementation that `DeciderState` (`0xDEC1DE02`) currently points to.

**Fees under `FeeRouter`.** When that implementation is `FeeRouter`, each transaction is charged in this order:

1. **Voucher.** It burns one voucher if the sender holds one.
2. **USDST.** Otherwise it charges $0.01 USDST, split into two parts:
    - **Proposer's share.** A `proposerFeeBps` share, read from the staking contract, goes to the staking contract. It is credited to the block proposer's operator and delegators, and claimable in USDST.
    - **Remainder.** The rest goes to `FeeCollector` (`0x100d`).
3. **Accounting.** It calls the staking contract's `processBlock()`, which updates fee attribution and the liveness counters. A failure there never blocks the transaction.

**Block rewards.** Once per block, before the block's transactions, the node calls `payBlockRewards()` on the current fee implementation. `FeeRouter` pays the proposer a flat 0.01 STRATO out of its own STRATO balance:

- **An unfunded router pays nothing** and never reverts, so an empty reward pool can't stall the chain.
- **The `BlockRewardsPaid` event** is included in the block's first receipt, from the fork heights listed on [Networks](networks.md#fork-heights).

Whether `FeeRouter` is the active fee implementation depends on each network's `DeciderState` configuration.

For how users pay fees, see [Transactions and Fees](transactions-and-fees.md).
