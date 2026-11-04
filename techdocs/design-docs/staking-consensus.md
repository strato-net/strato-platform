# Staking Phase 2 — Stake-Weighted Proposer Selection, Fee Routing and Liveness Accounting

## Overview

Phase 1 staking (`StratoStaking`, `ValidatorRegistry`) had no consensus effect. Phase 2 wires
stake into consensus without changing how the platform trusts on-chain data: exactly like the
existing `ValidatorAdded/ValidatorRemoved` pipeline, everything consensus needs is published by
`MercataGovernance` (genesis address `0x100`), folded into the block header by the proposer and
re-derived by every validator. There are no epochs and no frozen sets: the parent block's
validator set and stake weights elect and validate the child; stake changes apply one block later.
(Companion documents: `staking-next-phases.md`, `staking-leader-selection-epochs.md`.)

```
StratoStaking ──(stake/unstake/self-bond/slash)──► MercataGovernance(0x100)
      emits ValidatorAdded / ValidatorRemoved / ValidatorStakeUpdated(validator, stake)
  ──► Delta.hs ──► ExecResults ──► Bagger.buildNextBlockHeader
  ──► BlockHeaderV3 { …V2 fields…, proposalRound, currentStakes, stakeUpdates }
  ──► verifyBlock re-derives stakeUpdates ──► Blockstanbul applies stakes on commit
  ──► leader(height, round) = selectProposer(chainId, height, validators, stakes, parentRound, round)
```

**Key files**

| Concern | File |
|---|---|
| Selection algorithm (pure) | `strato/core/strato-model/src/Blockchain/Strato/Model/ProposerSelection.hs` |
| Stake delta from events | `strato/core/strato-model/src/Blockchain/Strato/Model/Delta.hs` |
| Header V3 | `strato/core/blockapps-data/src/Blockchain/Data/BlockHeader.hs` |
| Consensus | `strato/core/blockstanbul/src/Blockchain/Blockstanbul/{EventLoop,StateMachine,Authentication}.hs` |
| Block verification | `strato/core/vm-runner/src/Blockchain/BlockChain.hs` (`verifyBlock`) |
| `block.prev*` facts | `strato/core/blockapps-data/src/Blockchain/Data/ProposalFacts.hs`, `BlockSummary.hs`, SolidVM builtins |
| Activation | `NetworkConf.stakingActivationBlock` (`strato/core/strato-conf/.../EthConf/Model.hs`) |
| Contracts | `app/contracts/concrete/Staking/{StratoStaking,ValidatorRegistry,FeeRouter,IStakingGovernance}.sol`, `app/contracts/concrete/Governance/MercataGovernance.sol` (mirror of `strato/core/strato-genesis/resources/strato/`) |

## Proposer selection

`selectProposer chainId height validators stakes parentRound round` (pure, `strato-model`):

* candidates are the validators in address order; weight = stake published by governance
  (missing ⇒ 0);
* `x = keccak256(chainId ‖ height ‖ round) mod totalWeight`, walk cumulative weights. The seed
  contains nothing the proposer chooses (no parent hash, no body), so the previous proposer cannot
  grind the next leader; leaders are predictable, which is fine for a known set of ≤ 50 operators;
* if the total weight is 0 the pick is uniform (`x mod n`) — this is the fallback until the
  validators register stake;
* the proposers picked for the earlier rounds of this height (`parentRound .. round-1`, at most
  `n-1` of them) are excluded, so a round change always moves to somebody else.

**Rounds persist across heights** (Blockstanbul's existing behaviour): `commitBlock` only advances
the sequence; the round advances on timeouts / 2/3 `ROUNDCHANGE`. Phase 2 stamps the round into
the header (`proposalRound`) together with `currentStakes` when Blockstanbul seals a proposal
(where it already stamps `currentValidators`); a locked block is re-proposed unchanged. Checks:
live peers require `parentRound <= header.round <= view.round`; syncing nodes
(`replayHistoricBlock`) and the VM (`verifyBlock`, `RoundMismatch`) require
`header.round >= parent.round`; both require the header to be V3, its validator/stake sets to
equal the local ones, and its seal to come from `selectProposer(..., parentRound, header.round)`.
A restarted validator resumes at the best block's round (`BestSequencedBlock` / `Checkpoint`
carry it) so it agrees with its peers on the current proposer.

Timers are keyed by view (`Timeout View` / `ResetTimer View`, sequence-major `Ord View`) and are
re-armed at every new height. A missed proposal is detected by the 2–5 s view watchdog
(`createNewViewTimer`); `roundPeriodS` (now 3600) is only a backstop after an hour without a
block, so under normal operation the round rarely changes.

## Stake-weighted quorum

From the same activation height, PREPARE / COMMIT and ROUNDCHANGE tallies in the event loop and the
commit-seal check in `replayHistoricBlock` use `3 · voteStake > 2 · totalStake` (ROUNDCHANGE
piggyback at `> 1/3`) over the weights in force for the block (`voteWeights`, `hasSupermajority` in
`StateMachine.hs`). Weights are in force once the set's vector is complete (#7649: a set with
unpublished members is tallied by headcount, so no member can be the quorum alone while the others'
weights are still missing); #7650 publishes the full vector after the fork. The adopted rule for
what follows (`staking-admission-and-rewards-decisions.md`, decision 2) is that a published zero is
an entry, so once the vector is complete a zero-stake member weighs zero and headcount never
returns; that node-side refinement is a dependency on top of #7649 / #7650, not part of this branch.

**Activation precondition:** every current validator must have its stake weight published
(registered + `tryActivate`d, `setGovernance`) *before* the activation height, and admission
(`joinsOpenFromBlock`) opens only after the full vector is published. Weighted votes mean an
operator holding more than 1/3 of the stake can stall the chain; holding that share is not
misconduct on its own, and there is no per-key stake cap and no single-key kick. The remedies are
the evidence-based liveness removal (twenty consecutive missed proposals, by anyone), the
quality-control removal with published grounds and a week's notice (or the one-validator emergency
path), and, for a stalled chain, the network's extraordinary process. The validator-set size is
bounded on-chain (`MercataGovernance.hardCapValidators`, applied to both the staking and the
admin-vote path, in addition to `StratoStaking.effectiveCap`); consensus itself never rejects a
committed membership change, so a cap violation is a reverted transaction, not a stalled chain.

## What contracts see

Because Blockstanbul stamps the round after transactions were executed, contracts do not see the
current block's round. Instead every block exposes facts about its **parent**, derived purely from
the parent header and stored in its `BlockSummary`:

* `block.prevProposer` – recovered from the parent's proposer seal
* `block.prevIntendedProposer` – `selectProposer(chainId, parent.number, parent.currentValidators, parent.currentStakes, grandparent.round, grandparent.round)`,
  i.e. who was meant to propose at the round the height started at
* `block.prevRound` – the parent's `proposalRound`

All three are zero when the parent predates staking. `block.proposer` (== `block.coinbase`) is
the current proposer as before. Tests may set all of them with the test-only builtin
`setBlockContext(proposer, prevProposer, prevIntendedProposer, prevRound)`.

## Fee routing and liveness accounting (no new platform hook)

Blocks only exist when they contain a transaction, and the platform delegatecalls the fee
implementation (`Decider 0xDEC1DE` → `DeciderState.currentFeeContract`) for every transaction, so
`FeeRouter.payFees()` runs at least once per block:

1. burn one voucher, else charge $0.01 USDST to `FeeCollector 0x100d`, the fee sink. The router
   still asks the staking contract for a `proposerFeeBps` share and, once per block, offers it a
   flat 0.01 STRATO through `creditBlockReward`; the staking contract defines neither any more,
   the router catches both, and so gas pays for the network and nothing else. (Removing the dead
   router paths belongs to the gas-fee revision, a separate change.)
2. `StratoStaking.processBlock()` (always, in a try/catch): once per `block.number`, counts the
   parent block's proposal (readiness evidence for its producer) and any miss, pays the parent
   block's producer from the emission schedule (below), and drops seats governance has removed.

USDST reaches validators only as discretionary rewards now; the USDST claim path
(`claimFeeRewards` / `claimOperatorFeeRewards`) stays for those and for history. USDST sent to the
contract directly is credited to nobody and recoverable by nobody.

**Discretionary rewards** are the second source of income, open to anyone with tokens to give.
`distributeRewards(tokens, amounts, validators)` splits each amount across the listed validators by
stake weight (an empty list means the consensus set; division dust goes to the last recipient with
stake), and `distributeRewardsTo(tokens, amounts, validators)` credits each amount in full to the
matching validator. The caller approves staking and staking pulls each token, so a credit is always
what actually arrived. STRATO joins block-reward accounting and USDST joins fee accounting, split
and claimed the same way. Any other token goes wholly to the validator's operator, owed to that
operator account (`pendingOperatorTokenRewards[operator][token]`, claimed with
`claimOperatorTokenRewards`), because sharing it with delegators would mean settling every such
token on every stake change. `recoverStrayToken` never takes a token's unclaimed rewards.

**The emission schedule** is the main source, and the committed one: STRATO prefunded into
`rewardReserve` (`fundRewardReserve`, anyone may pay in, nobody may take out) pays each finalised
block's producer (`block.prevProposer`, at the next block's `processBlock`) the release of
`E = E0 · sqrt(S / S0) · (R / R0)` a year for the interval the block closed, capped at
`MAX_CREDITED_GAP_SECONDS` (an hour); `S` is the stake behind the earning set (`eligibleStake`:
seated, indexed, listed and eligible validators) and `R` the reserve still unreleased. Stake decides
who produces, so the payment is not weighted by stake again; a gap beyond the cap stays in the
reserve and only raises `R`; nothing is paid before the committed start, and a producer that is not
seated, listed and eligible (a seat kept only because its departure was deferred, a delisted
validator) is paid nothing. `commitEmissionSchedule(e0, s0, r0, startTime)` (owner vote) commits the
calibration once, requires the reserve to already hold `r0`, and has no pause, restart or
re-calibration; top-ups raise `R` only. The amount is credited at once (`_creditRewards`), split
between the operator's *qualified* self-bond and the *qualified* delegations (commission on the
delegations' share only), and claimed through `claimRewards` / `claimOperatorRewards`. The reserve
only ever moves into `allocatedRewardLiability`: claims never dip into it and there is no recovery
call of any kind (`untrackedStrato()` reports what a direct transfer left; nobody can take it).
Integer arithmetic throughout (`sqrt(S / S0)` is taken as `sqrt(S · S0) / S0`), bounded well inside
`uint256` for any stake up to the total supply.

**Qualification.** A delegation or self-bond earns only once it has been in place for
`NOTICE_SECONDS` (a week); the clock is the stake-weighted average placement time, so a top-up moves
it in proportion and a move restarts it. Waiting stake votes with its full weight and takes no
income (the record's `unqualifiedDelegatedStake` / `unqualifiedSelfBond` is left out of the split;
with nothing qualified, the block's share stays in the reserve). A position that has waited its
week earns from its next touch (`qualifyStake(user, validator)`, permissionless, or any stake
action). Positions that predate the upgrade are qualified from the start. This is the
anti-chasing rule of decision 3; `moveLockedUntil` and the unbonding hold are gone, principal is
paid in the same transaction as `unstake` / `unbondSelf`, and requests the previous logic queued
are withdrawable at once.

`FeeRouter` runs in the signer's storage context and therefore keeps no storage; its addresses are
genesis constants behind internal getters. `StratoStaking.processBlock` trusts only `block.*`
builtins, never `msg.sender`, and must never revert.

**Liveness, not slashing.** `blocksProposed[prevProposer]++` and the producer's readiness evidence
is refreshed; if `prevIntendedProposer != prevProposer` then `missedProposals[intended]++`,
`consecutiveMisses[intended]++` and `ProposalMissed` is emitted (a proposal resets the streak). A
miss costs the missed block's income and feeds the dashboard; nothing seizes tokens. A miss is
consensus-derived but **not cryptographically attributable** — a round change carries no signed
"missed proposal" evidence and the round can change right after the previous commit — so real
slashing waits for provable round changes (Phase 4). At `LIVENESS_MISS_LIMIT` (twenty) consecutive
misses anyone may call `removeForMissedProposals(v)`: the validator leaves the set with its stake
untouched and may be seated again after `NOTICE_SECONDS` on fresh readiness evidence.

**Readiness.** A validator key reports its vault and transaction path working with
`acknowledgeReadiness()` (from the key itself), good for `READINESS_WINDOW_SECONDS` (a day): what a
candidate shows before it is seated. Once seated, producing is the evidence: a finalised proposal
(`lastProposedBlock`) is good for `READINESS_WINDOW_BLOCKS` (500 blocks), so a quiet chain does
not make its validators look absent. Every change to the set or to a seated
validator's weight must leave the resulting set *safe* (strictly more than two thirds, and at least
`READY_WEIGHT_BPS` = three quarters, of its weight ready) or must not lower the ready share;
otherwise it reverts with `SS: unsafe transition` and is retried later. Removing an unready member
or adding a ready one always passes; a set with no evidence at all is not made worse by anything.

Eligibility: `selfBond >= MIN_SELF_BOND` (10,000 STRATO, a constant) — a validator must have its
own stake at risk; delegated stake adds weight but cannot qualify it. A seat held since before this
logic (`seatedUnderSelfBondRule == false`) keeps the rule it was admitted under,
`selfBond + delegatedStake >= MIN_SELF_BOND`, until it leaves the set or changes operator; nothing
expires it. Also: listed, past any liveness reentry wait (`jailedUntil`). Below the threshold ⇒
`removeValidatorFromStaking` (governance never drops its last validator; a seat that stays only
because it cannot be removed earns nothing); re-joining is an explicit `tryActivate` under the
self-bond rule and fresh evidence.

## Governance

`MercataGovernance` (upgraded behind its `Proxy` at `0x100`) gained `stakingContract`
(`setStakingContract` by admin vote), `validatorStake`, `stakingManaged` and the staking-only
entrypoints `addValidatorFromStaking(validator, stake)` (idempotent),
`updateValidatorStake`, `removeValidatorFromStaking` (returns `false` for non-managed or last
validators). Admin voting is unchanged.

`StratoStaking` calls governance whenever a validator's self-bond, delegated stake or activity
changes; the link is wired once (`setGovernance`) and has no off switch. Both `StratoStaking` and
`ValidatorRegistry` are keyed by validator address; the operator (the account that self-bonds,
sets commission and collects the operator share) is a field of the record. Binding a validator to
an operator needs the validator key's consent: `ValidatorRegistry.register(validator, …, v, r, s)`
/ `setOperator` verify a secp256k1 signature by the validator key over
`keccak256(abi.encodePacked("STRATO validator operator authorization", registry, validator,
operator, authorizationNonce[validator]))` (raw digest, since node vaults sign raw hashes; the
nonce makes each consent single use), or the validator key sends the transaction itself. A first
admin listing (`addValidator(s)`) is the only unsigned path; a relisting keeps the operator, and
there is no admin reassignment. A consented `setOperator` binds in the registry at once and is an
*announcement* in staking (`pendingOperator`, `operatorChangeReadyTime`): the record keeps its
operator for `NOTICE_SECONDS`, then the incoming operator completes it with
`acceptOperator(validator, bond >= MIN_SELF_BOND)`, which pays the outgoing operator what it earned,
returns its self-bond at once, keeps every delegation in place and ends an incumbent's exemption.
Binding back to the record's operator withdraws the handover.
`deploy/sign-validator-authorization.js` produces the signature from a node's vault.

`operatorAuthorizationDigest` reads the nonce as `authorizationNonce[validator] + 0`, and the
`+ 0` is load-bearing. SolidVM feeds a never-written storage slot to `abi.encodePacked` as zero
bytes rather than as `uint256(0)`, so without it the on-chain digest for a validator that has not
yet consented (every validator, initially) was 32 bytes shorter than the one every off-chain
signer hashes, and no first `register` / `setOperator` signature could verify (helium, found
2026-09-24). The off-chain encoders (backend, staking page, `sign-validator-authorization.js`)
were always correct and must keep encoding the nonce as 32 bytes. The same rule applies to any
SolidVM contract: never feed a possibly-unwritten storage read to `abi.encodePacked` without
`+ 0` or an explicit cast.

## Validator lifecycle (permissionless eligibility, bounded set)

Status is derived, not stored: **Missing** (no record) → **Registered** (listed; may self-bond and
receive stake; `ValidatorRegistry.register(...)` is permissionless given the validator key's
consent, admin `addValidator` still works) → **Active** (in the consensus set) → **Kicked**
(removed by the quality-control account with published grounds after a week's notice, or at once on
the emergency path; self-bond paid back to the operator at once; re-listing after `NOTICE_SECONDS`,
under the same operator). `StratoStaking.status(v)` / `eligible(v)` / `isWaiter(v)` /
`isReady(v)`, all by validator address.

* `eligible = listed ∧ meets the self-bond minimum (incumbents: self-bond plus delegations) ∧ past any liveness reentry wait`
* `isWaiter = eligible ∧ not seated ∧ isReady`
* **Leaving is automatic and same-tx** (`_syncValidator` at the end of every stake mutation): an
  Active validator that stops being eligible is removed from governance (counts one set mutation;
  with the per-block budget spent it keeps its seat until a later sync and earns nothing
  meanwhile). Weight changes are pushed the same way. Every mutation then checks the safe-set rule.
* **Joining is explicit**: `tryActivate(v)` (anyone, from `joinsOpenFromBlock`; nobody before it,
  the owner included) needs eligibility, fresh readiness evidence and either a free slot below
  `effectiveCap = min(maxActiveValidators, hardCapActiveValidators)` or the lowest validator
  (weight asc, address asc) beaten by `EVICTION_MARGIN_BPS` (5%); a replacement sends the loser
  back to Registered (self-bond stays bonded) and counts as two of the block's
  `MAX_SET_MUTATIONS_PER_BLOCK` (two) changes. `reconcileSet(candidates)` promotes the named
  waiters by (weight desc, address asc) within the budget; set-wide passes (replacement, resyncs,
  readiness) walk only the consensus set (`activeValidators`), never every record, so cheap sybil
  registrations cannot make them unaffordable. Removals of every kind are bounded by the same
  budget. `exit(v)` takes a validator out at once, subject to the safe-set rule; the last validator
  cannot exit (governance keeps it) and its departure is the network's to coordinate.
* There is no per-key stake cap: stake-weighted votes and the common admission rules are the
  protection, and a cap one party can route around with more keys is not.
* Votable: `setSetParams(maxActiveValidators, hardCapActiveValidators [only lowers])`,
  `setJoinsOpenFromBlock(block)` (ahead only; never closed again), `setParams(maxCommissionBps,
  maxBatchSize)`, `commitEmissionSchedule(e0, s0, r0, startTime)` (once), `setGovernance(0x100)`
  (once). Constants: `MIN_SELF_BOND`, `NOTICE_SECONDS`, `READINESS_WINDOW_SECONDS`, `READINESS_WINDOW_BLOCKS`,
  `READY_WEIGHT_BPS`, `MAX_CREDITED_GAP_SECONDS`, `LIVENESS_MISS_LIMIT`,
  `MAX_SET_MUTATIONS_PER_BLOCK`, `EVICTION_MARGIN_BPS`. `initialize` seeds 50 / 50 and no join
  height or schedule. Commission: the operator cuts at once and raises on a week's notice; there is
  no admin setter.

Opening admission requires stake-weighted PBFT votes to be live (Key Decision 12 of
`staking-next-phases.md`) and the full stake vector published (#7650), i.e. the activation height
has passed on every producer; until the agreed block, governance's own admin vote is the only way
the set changes.

## Activation and rollout

`stakingActivationBlock` (ethconf / `strato-setup --stakingActivationBlock`) gates V3 headers,
per-height rounds and weighted selection. `Nothing` = from genesis (fresh dev/test networks); the
existing live networks default to "not scheduled" so an upgrade never switches consensus rules by
itself — set an explicit height (> every node's head) and restart validators before it. Before
activation the node behaves as today (V2 headers, sticky round-robin), except that timers are
view-aware.

Ops order (helium, then upquark; "vote" = AdminRegistry issue; the activation height switches V3
headers, weighted leaders and weighted votes together): (1) ship the platform release with the
activation height, #7649 and #7650; (2) deploy `StratoStaking` + `ValidatorRegistry` behind
`Proxy` (V1 is not upgradeable), `initialize(...usdst)`, `setValidatorRegistry`; (3) upgrade
governance logic (`setLogicContract`), vote `setStakingContract`; (4) list the current validators
as operators with their node vault addresses, stake ≥ 10,000, `setGovernance(0x100)`, then
`tryActivate` each (or `reconcileSet`) once their keys have acknowledged readiness,
`setSetParams(maxActiveValidators = live n, …)`, `gov.setHardCapValidators(50)` — all before the
activation height; (5) deploy `FeeRouter` and `DeciderState.updatePayFeeContract` (owner key); (6)
after activation, `bootstrapstakes` (#7650), then vote `setJoinsOpenFromBlock`; (7) fund the
reserve and `commitEmissionSchedule`. The Upquark in-place upgrade is
`app/contracts/deploy/RUNBOOK-upquark-admission-and-emissions.md`. Fresh networks get `FeeRouter`
at `0xDEC1DE03` from genesis.

## Known limitations (accepted for this phase)

* leaders are predictable (deterministic seed); a stake shift can target a known future slot only
  one block later and only within the 10k / unbonding constraints;
* a locked block re-proposed in a later round makes the next height's miss detection
  false-positive once (counter only);
* forcing a round change needs f+1 colluding validators (unchanged IBFT property);
* `moveStake` is instant and free; weights apply the next block (no epochs), the moved stake
  earns only after a week;
* readiness evidence before admission proves key control and a working transaction path, not
  execution correctness; that is proven by finalised production and policed by the liveness
  removal;
* Blockstanbul message signatures lack domain separation (`getHash`) and round changes carry no
  signed evidence — both are prerequisites for real slashing.
