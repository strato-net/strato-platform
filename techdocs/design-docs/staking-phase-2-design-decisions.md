# Staking Phase 2 — design decisions and changes (for review)

Branch: `staking-phase-2`. Companion docs: `staking-consensus.md` (mechanism reference),
`staking-next-phases.md` (rev 7 product spec), `staking-leader-selection-epochs.md`.

## 1. Goal

Move from "staking is bookkeeping" to "staking drives consensus", in one coordinated release:

1. **Stake-weighted, per-block proposer selection** that every node (validators, syncing nodes, the VM)
   derives deterministically from block headers — no epochs, no frozen sets, no VRF.
2. **Automated validator management**: stake crossing the threshold adds/removes validators in
   `MercataGovernance` (the set consensus actually uses); permissionless eligibility inside today's
   PBFT envelope (~50 validators).
3. **A proposer share of transaction fees** (USDST) routed to the proposer's operator and delegators.
4. **Liveness accounting** instead of slashing: missed proposals cost the block's fees and are recorded;
   no tokens are seized in this phase.
5. **Stake-weighted PBFT votes**, shipped at the same activation height, so permissionless joins cannot
   buy headcount quorum.

Cryptoeconomics are "good enough to get going"; the accepted limitations are listed at the end.

## 2. Decisions (with rationale)

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| D1 | **Weights travel in the block header (`BlockHeaderV3`)**, sourced from `MercataGovernance` (0x100) events, exactly like `currentValidators`/`newValidators`/`removedValidators` today. | Consensus is a pure state machine fed by headers; syncing nodes (`replayHistoricBlock`) never run the VM. Header transport is race-free (weights for height *h+1* are fixed when *h* commits) and lets syncing nodes verify the proposer. | Out-of-band push from the vm-runner (async → nodes can disagree on the leader); stuffing weights into `extraData` (opaque; still a format change). |
| D2 | **Source of truth stays 0x100 only.** `Delta.hs` consumes a new `ValidatorStakeUpdated(validator, stake)`; `StratoStaking` calls staking-gated governance entrypoints. | One trust anchor for consensus data; no per-network staking address in the node; governance is already a Proxy (`setLogicContract`) so the upgrade is a vote. | Whitelisting `StratoStaking` for `voteToAddValidator` via AdminRegistry (works for add/remove but cannot carry weights). |
| D3 | **Selection = deterministic, stake-weighted pick, seed `keccak(chainId ‖ height ‖ round)`.** Candidates in address order; `x = seed mod totalWeight`, walk cumulative weights; uniform fallback while nobody has stake; earlier rounds of the same height are excluded. | Nothing in the seed is chosen by the proposer → no tx-inclusion grind. Predictable leaders are acceptable for a known set of ≤ 50 operators. Per-block rotation comes from `height`, round changes land on someone else from `round` + exclusion. | Parent-hash seed (grindable by the previous proposer); VRF (new crypto, Phase 3); Tendermint-style priority accumulator (also fine; hash pick was preferred by the team). |
| D4 | **PBFT rounds persist across heights** (STRATO's existing behaviour) and are now **stamped into the header** (`proposalRound`). Live: `parentRound ≤ header.round ≤ view.round`; historic/VM: `round ≥ parent.round`; both: seal signer == selected proposer. | Matches the running code; the only new thing is recording the round so replay/VM can verify. A restarted validator now resumes at the best block's round instead of 0. | Per-height round reset (my first implementation; cleaner "round>0 ⇔ miss" semantics, but diverges from the existing machine — reverted). |
| D5 | **No epochs / frozen sets.** Parent's validators and weights elect and vote on the child; stake changes apply one block later. | Epoch boundaries are complexity without benefit at ≤ 50 validators; a one-block lag already prevents voting under a set you just changed. Full weight vector kept in the header (no Merkle root) so a later Q-committee needs no new header version. | Lagged snapshot + reject-on-mismatch (halts on every join/kick). |
| D6 | **Contracts see the *parent* block's facts**: `block.prevProposer`, `block.prevIntendedProposer`, `block.prevRound` (derived from the parent header and the grandparent's round; stored in `BlockSummary`). `block.proposer` stays the current proposer. | Blockstanbul stamps the round after the VM executed the block; feeding the live round into execution would invalidate the mining cache on every round change. | New per-block platform hook (`payFees` already runs ≥ 1× per block because empty blocks are not produced). |
| D7 | **Fee routing via a swappable fee impl (`FeeRouter`)**: voucher, else $0.01 USDST split `proposerFeeBps` → `StratoStaking`, rest → `FeeCollector`; then `StratoStaking.processBlock()` (try/catch). | `DeciderState.updatePayFeeContract` is the existing upgrade path; `block.proposer` is already visible there. Router runs under DELEGATECALL in the signer's context, so it keeps no storage; staking trusts only `block.*`. `proposerFeeBps = 0` keeps today's behaviour until ops flip it. | Direct USDST to the validator address (no delegator sharing). |
| D8 | **USDST fees have their own accounting and claim path** (`claimFeeRewards` / `claimOperatorFeeRewards`), mirroring the STRATO index math; STRATO claims stay STRATO-only. | Spec 4B: fee share is USDST real yield, residual emissions stay STRATO; don't mix tokens in one index. | Paying USDST inside `claimRewards`. |
| D9 | **Liveness, not slashing.** `processBlock` counts `blocksProposed` / `missedProposals` / `consecutiveMisses` per validator, emits `ProposalMissed`; optional `maxConsecutiveMisses` → temporary jail (removed from the set, stake untouched, re-activatable after `jailCooldown`). Notable downtime = admin kick. | A round change carries no signed "missed proposal" evidence, so a miss is consensus-derived but not cryptographically attributable; real slashing waits for provable round changes (+ domain-separated consensus signatures). PBFT's risk is liveness, not safety. | Self-bond slashing of intended/fill-in proposers (my first implementation — removed); evidence-based header jail (spec rev 7 — too heavy for a first pass). |
| D10 | **Eligibility = `selfBond + delegated ≥ minStake` (10k), `selfBond ≥ minSelfBond` (0 until slashing), validator address bound, not jailed, no exit due.** | Matches tokenomics (10k) and the current operator base (most meet it with delegation); a self-bond floor only matters once stake is at risk. | Self-bond-only eligibility. |
| D11 | **Lifecycle: leaving is automatic (same-tx), joining is explicit.** Status derived (Missing/Registered/Active/Kicked). `tryActivate` fills a slot or evicts the lowest validator by `evictionMarginBps`; `reconcileSet` promotes waiters; `requestExit` with notice; kick bypasses the per-block mutation budget; inbound stake capped at `maxOperatorStakeBps` (0 = off, enable after bootstrap). `joinsPaused` default true (owner may still activate). | Spec §2A/2B semantics without a stored enum (no storage migration) and without the evidence jail. Same-tx demotion keeps governance and staking from diverging; explicit activation keeps the set bounded. | Implicit auto-add on eligibility (my first implementation — replaced). |
| D12 | **Stake-weighted PBFT votes at the same activation height** (`3·voteStake > 2·totalStake` in PREPARE/COMMIT/ROUNDCHANGE and in `replayHistoricBlock`; zero-stake validators count on neither side; headcount while nobody has stake). `joinsPaused=false` only after this is live everywhere. | Key Decision 12: unweighted votes + open join is a cheap seat takeover. Single activation height on Helium and Upquark (decision 2026-08-19). | Leaders-only weighting with open joins. |
| D13 | **Validator-set hard cap enforced on-chain (`MercataGovernance.hardCapValidators`)**, not as a consensus rejection. | A node refusing a committed membership change would stall the chain; a revert cannot. | Node-side `newValidators` rejection. |
| D14 | **1/3-of-stake tooling**: inbound cap + `ValidatorRegistry.emergencyKick` by a dedicated `emergencyKicker` key, only for an operator over 1/3 (`exceedsOneThird`). | Under weighted quorum a >1/3 holder can stall and cannot be jailed (nothing commits without its seal). | Auto-jail (unsatisfiable). |
| D15 | **Activation is a per-network config height** (`stakingActivationBlock`; `Nothing` = from genesis for fresh nets; live nets default to "not scheduled"). `roundPeriodS` 120 → **3600** as a backstop only. | Mixed-version validators stall until all upgrade; a height lets nodes upgrade ahead of time. The 2–5 s view watchdog already detects a missed proposal; with per-block selection the round should rarely change under normal operation. | Immediate activation on upgrade; 4 s round period (spec) — unnecessary churn with the watchdog in place. |

## 3. What changed

### Node (`strato/`)
- `BlockHeaderV3` (`proposalRound`, `currentStakes`, `stakeUpdates`; RLP tag 3), SQL `BlockStakeRef` + nullable `proposalRound`, JSON/API; `Delta.getStakeDeltasFromEvents`; `verifyBlock` gains `StakeMismatch` + `RoundMismatch` and version gating.
- `Blockchain.Strato.Model.ProposerSelection.selectProposer chainId height validators stakes parentRound round`.
- Blockstanbul: `_stakes`, `_chainId`, `_lastRound` in context (checkpoint/`BestSequencedBlock` carry stakes + round); `stampAndSeal` stamps round + stakes where it stamps validators; `checkProposalHeader`; weighted tallies (`voteWeights`/`hasSupermajority`); view-keyed timers (`Timeout View`, sequence-major `Ord View`, re-armed per height).
- `ProposalFacts` in `BlockSummary`; SolidVM builtins `block.prevProposer/prevIntendedProposer/prevRound`, test-only `setBlockContext(...)`.
- Config: `NetworkConf.stakingActivationBlock`, `roundPeriodS = 3600`; genesis installs `FeeRouter` at `0xDEC1DE03`.
- Tests: strato-model selection properties, vm-tools (RLP/summary/delta/facts), blockstanbul `StakingConsensusSpec` (rounds, timers, stakes, quorum, proposal checks).

### Contracts (`app/contracts`, genesis mirror for governance/FeeRouter)
- `MercataGovernance` V2: `stakingContract`, `validatorStake`, `ValidatorStakeUpdated`, `addValidatorFromStaking` / `updateValidatorStake` / `removeValidatorFromStaking` (never drops the last validator), `hardCapValidators`.
- `ValidatorRegistry` V2: `validatorAddress` binding (unique), permissionless `register`, `setValidatorAddress`, `emergencyKick` / `setEmergencyKicker`, 4-arg `syncOperator` + `syncValidatorAddress`.
- `StratoStaking` V2 (new deployment behind `Proxy`; V1 is not upgradeable): governance sync (`setGovernance` kill switch), `setValidatorParams(minStake, minSelfBond, proposerFeeBps, maxConsecutiveMisses, jailCooldown)`, `setSetParams(...)`, lifecycle (`tryActivate`, `reconcileSet`, `requestExit`, `cancelExit`, `syncValidator`, `status`, `eligible`, `isWaiter`, `exceedsOneThird`), `processBlock()` (fee attribution + counters + optional jail), USDST fee indexes + `claimFeeRewards` / `claimOperatorFeeRewards`, `recoverUnattributedFees`.
- `FeeRouter.sol` (fee impl). Tests: StratoStaking 39, ValidatorRegistry 10, MercataGovernance 7, FeeRouter 5 (`solid-vm-cli test`).

### App (`app/backend`, `app/ui`)
- Backend: `/staking/info` carries V2 state (status/eligible/isWaiter, blocks proposed/missed, USDST pending fees, set params); user endpoints `register`, `activate`, `reconcile`, `sync`, `exit`, `exit/cancel`, `profile`, `claim-fees`, `operator/claim-fees`; admin votes for validator address, validator/set params, governance wiring (`setStakingContract`, hard cap, sync), fee recovery, emergency kicker; `addOperator(s)` takes `validatorAddress`; activity-feed configs for the new events.
- UI: Earn Staking page shows status badges, blocks/missed, USDST fee claims, operator lifecycle (Activate / Request exit / Cancel), "Become a validator" registration; Admin → Staking tab for parameters, governance wiring and operator management; activity cards.

## 4. Rollout (summary — details in `staking-consensus.md`)
1. Ship the node release with `stakingActivationBlock` per network (> every node's head); `roundPeriodS` 3600.
2. Deploy StratoStaking V2 + ValidatorRegistry V2 behind `Proxy`; initialize; `setValidatorParams`, `setSetParams` (joins paused), `setGovernance(0x100, false)`.
3. Governance logic upgrade (`setLogicContract` on 0x100), `setStakingContract`, `setHardCapValidators(50)`, `setEmergencyKicker`.
4. List every current validator with its node address, bond ≥ `minStake`, `setGovernance(0x100, true)`, `tryActivate` each — **all before the activation height** (with weighted votes, unstaked validators cannot vote).
5. Deploy `FeeRouter`, `updatePayFeeContract`; `proposerFeeBps` > 0 when ready.
6. After activation is live on all producers: `joinsPaused=false` (and `maxOperatorStakeBps=3300`).
7. V1 migration window (stop schedule, `unbondingSeconds=0`, users unstake/restake).

## 5. Accepted limitations / follow-ups
- Leaders are predictable; a stake shift can target a future slot only one block later (10k + unbonding make it noise).
- A locked block re-proposed in a later round makes the next height's miss detection false-positive once (counter only).
- Misses are not provable → no slashing until round changes carry signed evidence; then also fix `getHash` domain separation.
- Validator-address binding has no proof of possession yet (admin-set, or self-registered).
- Quorum/leader math is per-validator stake; no Q-committee yet (header already carries the full vector for it).
- Not yet done: deploy/migration scripts, PR 0 live measurements, multi-validator Helium chaos run.
