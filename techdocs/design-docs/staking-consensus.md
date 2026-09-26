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
`StateMachine.hs`): validators without stake weigh 0 and count on neither side; while **nobody**
has stake every validator weighs 1 (headcount), as before activation.

**Activation precondition:** every current validator must have its stake weight published
(registered + `tryActivate`d, `setGovernance(…, true)`) *before* the activation height. With weights
live, one staked validator among unstaked peers is a one-validator quorum. Consequences of weighted
votes (Key Decision 16): an operator holding more than 1/3 of the stake can stall the chain and
cannot be jailed (nothing commits without its seal) — the tools are the inbound cap
`maxOperatorStakeBps` (3300) and `ValidatorRegistry.emergencyKick` by the `emergencyKicker` key
(only for a validator over 1/3, `StratoStaking.exceedsOneThird`), with an owner vote as the routine
kick. The validator-set size is bounded on-chain (`MercataGovernance.hardCapValidators`, applied to
both the staking and the admin-vote path, in addition to `StratoStaking.effectiveCap`); consensus
itself never rejects a committed membership change, so a cap violation is a reverted transaction,
not a stalled chain.

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

1. burn one voucher, else charge $0.01 USDST: `proposerFeeBps` (read from the staking contract) to
   the staking contract, the rest to `FeeCollector 0x100d`;
2. `StratoStaking.processBlock()` (always, in a try/catch): attributes the USDST received since the
   last call to the `block.proposer` validator's record (self-bond share to its operator,
   delegated share net of commission to delegators via a per-stake index — same shape as STRATO
   block rewards, but a separate USDST claim path `claimFeeRewards` / `claimOperatorFeeRewards`;
   unlisted proposers accumulate in `unattributedFees`), and once per `block.number` updates the
   liveness counters below.

**Block rewards** take the other hook: once per block the platform calls
`FeeRouter.payBlockRewards()`, which approves a flat 0.01 STRATO from the router's own balance and
calls `StratoStaking.creditBlockReward(block.proposer, amount)`. Staking pulls the approved amount
(so it can only credit what was paid) and splits it exactly like fees; `claimRewards` /
`claimOperatorRewards` pay it out. A proposer staking will not credit (unlisted, delisted) is not
paid and the reward stays in the router. The Phase 1 funded reward schedule was removed from V2
(an upgraded proxy settles what the schedule had already allocated to each record once, on its
next touch).

**Discretionary rewards** are the third source of income, open to anyone with tokens to give.
`distributeRewards(tokens, amounts, validators)` splits each amount across the listed validators by
stake weight (an empty list means the consensus set; division dust goes to the last recipient with
stake), and `distributeRewardsTo(tokens, amounts, validators)` credits each amount in full to the
matching validator. The caller approves staking and staking pulls each token, so a credit is always
what actually arrived. STRATO joins block-reward accounting and USDST joins fee accounting, split
and claimed the same way. Any other token goes wholly to the validator's operator, owed to that
operator account (`pendingOperatorTokenRewards[operator][token]`, claimed with
`claimOperatorTokenRewards`), because sharing it with delegators would mean settling every such
token on every stake change. `recoverStrayToken` never takes a token's unclaimed rewards.

`FeeRouter` runs in the signer's storage context and therefore keeps no storage; its addresses are
genesis constants behind internal getters. `StratoStaking.processBlock` trusts only `block.*`
builtins, never `msg.sender`, and must never revert.

**Liveness, not slashing.** `blocksProposed[prevProposer]++`; if `prevIntendedProposer !=
prevProposer` then `missedProposals[intended]++`, `consecutiveMisses[intended]++` and
`ProposalMissed` is emitted (a proposal resets the streak). A miss costs the missed block's fees
and feeds the dashboard (uptime / missed opportunities); nothing seizes tokens. A miss is
consensus-derived but **not cryptographically attributable** — a round change carries no signed
"missed proposal" evidence and the round can change right after the previous commit — so real
slashing waits for provable round changes (Phase 4). Optional knob: after
`maxConsecutiveMisses` (0 = off) the operator is jailed (`jailedUntil = now + jailCooldown`,
removed from the set, stake untouched; `syncValidator` re-adds it after the cooldown). Notable
downtime is an admin kick (`removeOperator` / governance vote).

Eligibility: `selfBond >= minStake` (10k) — a validator must have its own stake at risk; delegated
stake adds weight but cannot qualify it. `selfBondGraceUntil` phases this in for validators admitted
on delegated stake: while it is unset (0, as on an upgraded proxy) or in the future,
`selfBond + delegatedStake >= minStake` still qualifies. Also: listed, not jailed, no exit due.
Below the threshold ⇒ `removeValidatorFromStaking` (governance never drops its last validator);
re-joining is an explicit `tryActivate`.

## Governance

`MercataGovernance` (upgraded behind its `Proxy` at `0x100`) gained `stakingContract`
(`setStakingContract` by admin vote), `validatorStake`, `stakingManaged` and the staking-only
entrypoints `addValidatorFromStaking(validator, stake)` (idempotent),
`updateValidatorStake`, `removeValidatorFromStaking` (returns `false` for non-managed or last
validators). Admin voting is unchanged.

`StratoStaking` calls governance whenever a validator's self-bond, delegated stake or activity
changes (`governanceSyncEnabled` is the ops kill switch). Both `StratoStaking` and
`ValidatorRegistry` are keyed by validator address; the operator (the account that self-bonds,
sets commission and collects the operator share) is a field of the record. Binding a validator to
an operator needs the validator key's consent: `ValidatorRegistry.register(validator, …, v, r, s)`
/ `setOperator` verify a secp256k1 signature by the validator key over
`keccak256(abi.encodePacked("STRATO validator operator authorization", registry, validator,
operator, authorizationNonce[validator]))` (raw digest, since node vaults sign raw hashes; the
nonce makes each consent single use), or the validator key sends the transaction itself. Admin
listing (`addValidator(s)`) and `adminSetOperator` are the only unsigned paths.
`deploy/sign-validator-authorization.js` produces the signature from a node's vault.

## Validator lifecycle (permissionless eligibility, bounded set)

Status is derived, not stored: **Missing** (no record) → **Registered** (listed; may self-bond and
receive stake; `ValidatorRegistry.register(...)` is permissionless given the validator key's
consent, admin `addValidator` still works) → **Active** (in the consensus set) → **Kicked** (owner
`removeValidator`; self-bond force-unbonded to the operator; re-listing after `unkickCooldown`).
`StratoStaking.status(v)` / `eligible(v)` / `isWaiter(v)`, all by validator address.

* `eligible = listed ∧ meets minStake (self-bond; see selfBondGraceUntil) ∧ not jailed ∧ no exit due`
* **Leaving is automatic and same-tx** (`_syncValidator` at the end of every stake mutation): an
  Active operator that stops being eligible is removed from governance (counts one set mutation;
  if the per-block budget is exhausted the stake mutation reverts — fail closed). Weight changes
  are pushed the same way.
* **Joining is explicit**: `tryActivate(op)` (anyone once `joinsPaused=false`; the owner always)
  needs eligibility and either a free slot below `effectiveCap = min(maxActiveValidators,
  hardCapActiveValidators)` or the lowest validator (weight asc, address asc) beaten by
  `evictionMarginBps`; an eviction sends the loser back to Registered (self-bond stays bonded).
  `reconcileSet(candidates)` promotes the named waiters by (weight desc, address asc) within
  `maxSetMutationsPerBlock`; set-wide passes (eviction, resyncs) walk only the consensus set
  (`activeValidators`), never every record, so cheap sybil registrations cannot make them
  unaffordable. Kicks bypass the mutation budget. `requestExit(v)` keeps the validator serving for
  `exitNoticeSeconds`, then any sync removes it; `cancelExit(v)` undoes it.
* `maxOperatorStakeBps` caps **inbound** stake (stake / selfBond / moveStake target) at that share
  of `totalRewardableStake`; unstaking is never capped; 0 = off (switch it on after bootstrap).
* Params: `setValidatorParams(minStake, proposerFeeBps, maxConsecutiveMisses, jailCooldown)`,
  `setSelfBondGraceUntil(t)`, `setSetParams(maxActiveValidators, hardCapActiveValidators [only lowers],
  evictionMarginBps, maxSetMutationsPerBlock, exitNoticeSeconds, unkickCooldown,
  maxOperatorStakeBps, joinsPaused)`; `initialize` seeds 50 / 50 / 500 / 2 / unbonding / unbonding /
  0 / paused.

`joinsPaused=false` requires stake-weighted PBFT votes to be live (Key Decision 12 of
`staking-next-phases.md`), i.e. the activation height has passed on every producer; until then the
owner activates operators (today's admin-gated set).

## Activation and rollout

`stakingActivationBlock` (ethconf / `strato-setup --stakingActivationBlock`) gates V3 headers,
per-height rounds and weighted selection. `Nothing` = from genesis (fresh dev/test networks); the
existing live networks default to "not scheduled" so an upgrade never switches consensus rules by
itself — set an explicit height (> every node's head) and restart validators before it. Before
activation the node behaves as today (V2 headers, sticky round-robin), except that timers are
view-aware.

Ops order (helium, then upquark; "vote" = AdminRegistry issue; the activation height switches V3
headers, weighted leaders and weighted votes together): (1) ship the platform release with
the activation height; (2) deploy `StratoStaking` V2 + `ValidatorRegistry` V2 behind `Proxy`
(V1 is not upgradeable), `initialize(...usdst)`, `setValidatorRegistry`, `setValidatorParams`,
`setGovernance(0x100, false)`; (3) upgrade governance logic (`setLogicContract`), vote
`setStakingContract`; (4) list the current validators as operators with their node vault
addresses, stake ≥ `minStake`, `setGovernance(0x100, true)`, then `tryActivate` each (or
`reconcileSet`), `setSetParams(maxActiveValidators = live n, …, maxOperatorStakeBps = 3300,
joinsPaused = true)`, `gov.setHardCapValidators(50)`, `registry.setEmergencyKicker(<ops key>)` — all
before the activation height; (5) deploy `FeeRouter`
and `DeciderState.updatePayFeeContract` (owner key); (6) migrate V1 stakers (stop schedule,
`setParams(unbondingSeconds=0)`, users unstake/restake). Fresh networks get `FeeRouter` at
`0xDEC1DE03` from genesis.

## Known limitations (accepted for this phase)

* leaders are predictable (deterministic seed); a stake shift can target a known future slot only
  one block later and only within the 10k / unbonding constraints;
* a locked block re-proposed in a later round makes the next height's miss detection
  false-positive once (counter only);
* forcing a round change needs f+1 colluding validators (unchanged IBFT property);
* `moveStake` is instant; weights apply the next block (no epochs);
* Blockstanbul message signatures lack domain separation (`getHash`) and round changes carry no
  signed evidence — both are prerequisites for real slashing.
