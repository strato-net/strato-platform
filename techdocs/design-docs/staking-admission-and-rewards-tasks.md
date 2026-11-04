# STRATO — concrete changes and verification tasks (resolved list)

Handoff for [PR #7639](https://github.com/strato-net/strato-platform/pull/7639), continuing the
list reviewed on November 4 (the 26 original tasks are kept verbatim, with their status on this
branch) and adding the tasks that answering the eight open decisions generated. The decisions
themselves are in `staking-admission-and-rewards-decisions.md`. "Done" means implemented on this
branch in `StratoStaking.sol` (plus the justified registry edits), with tests written in the
SolidVM suites; "dependency" means the work is specified here and belongs to another change.

Verification status of this revision: backend `tsc --noEmit` clean; UI `tsc -b` and eslint show
only the errors that predate this change (none in the files it touches); the SolidVM suites
(`StratoStaking.test.sol` 56 cases, `ValidatorRegistry.test.sol` 12, `FeeRouter.test.sol`
unchanged at 13) were rewritten against the new contracts but **not executed**: no
`solid-vm-cli` build was reachable from the environment this revision was produced in. Running
them is the first task below.

## Original tasks

- [ ] **Integrate and verify both consensus fixes together.** *Dependency.* #7649 and #7650 are
  merged into this branch later and are not duplicated here. The contract side is done: weights
  are published for every seated validator, zero included; admission (`joinsOpenFromBlock`)
  opens only after the full vector; the runbook orders #7649, #7650, `bootstrapstakes`, then
  the agreed block. The node-side rule that a published zero is an entry (decision 2) is
  specified and left for the node change on top of #7649.

- [x] **Preserve incumbents and their self-bond exemptions until actual exit, removal or
  operator change.** `seatedUnderSelfBondRule` is set by `_seat`, so a seat that predates this
  logic qualifies on self-bond plus delegations with no deadline; a handover sets it; a
  departure of any kind ends it because re-seating goes through `_seat`. `selfBondGraceUntil`
  and its setter are gone.

- [x] **Require 10,000 operator-owned STRATO for new and returning validators.**
  `MIN_SELF_BOND` is a constant; `setValidatorParams` is gone; a handover requires the incoming
  operator's own bond of at least the minimum; delegations never qualify a non-incumbent.

- [x] **Remove the per-key concentration restriction.** `maxOperatorStakeBps`, `_withinStakeCap`,
  `exceedsOneThird` and the registry's `emergencyKick` are gone; stake-weighted voting and the
  common admission rules remain.

- [x] **Open public admission at the agreed block after coordinated launch readiness.**
  `setJoinsOpenFromBlock` is ahead-only and immovable once passed; `joinsPaused` and the owner's
  bypass are gone; nobody seats anyone before the block. Verification steps are in the runbook.

- [x] **Require objective, permissionless applicant readiness checks before voting power
  activates.** Decision 1: an `acknowledgeReadiness()` transaction from the validator key
  within the last day (`isReady`), checked by `tryActivate` / `reconcileSet`; once seated, a
  finalised proposal within 500 blocks is the evidence.

- [x] **Pay for successful finalized production, not merely remaining listed.** `_payProduction`
  pays `block.prevProposer` per finalised block, unweighted by stake, split between qualified
  self-bond and qualified delegations with commission on the delegations' share; the lazy
  pro-rata index is gone; persistent failure is handled by `removeForMissedProposals`.

- [x] **Keep the stated reward curve and establish one explicit funding commitment.** The
  formula and the calibration are unchanged; `commitEmissionSchedule` runs once and requires the
  reserve to hold `r0`; top-ups raise `R` only; nothing is paid before the start. The 10,000,000
  STRATO allocation is the runbook's proposed value awaiting confirmation.

- [x] **Make identical earning histories produce the same entitlement regardless of calculation
  frequency.** Amounts depend only on block timestamps and the state at the block; the gap cap
  removes the first-caller windfall; a claim or a late touch changes nothing. Rounding is the
  per-stake index's wei-level truncation (test: within 1,000 wei on a 1000-STRATO position).

- [x] **End the additional fixed 0.01 STRATO subsidy.** `creditBlockReward` is gone, so the
  router's offer pays nothing (its own catch path); already-credited claims are untouched. The
  router's own balance is a launch input (runbook §0, §7).

- [x] **Keep gas payments separate from reward funding.** `proposerFeeBps` is gone, so the router
  routes the whole USDST fee to the sink; `_syncFees` attribution is gone, so USDST sent to the
  contract is credited to nobody; historical fee claims keep their path. *Dependency:* the
  gas-fee revision (STRATO gas, STRATO bought with USDST) and the router cleanup.

- [x] **Remove ordinary authority to rewrite or bypass the funded terms.** Every rule is a
  constant; the schedule is committed once; `setValidatorParams`, `setSelfBondGraceUntil`, the
  governance off switch and the admin commission setter are gone. *Dependency:* binding the
  proxies' logic swaps to validator approval (decision 8).

- [x] **Remove discretionary reward pause, restart and catch-up powers.** No pause, no restart,
  no re-calibration; interruptions follow decision 4 (uncredited time stays in the reserve).

- [x] **Protect the committed reserve through exceptional changes as well as ordinary
  operation.** No recovery call exists; the runbook's rollback section forbids the downgrade
  refund and requires any reverting logic to carry the reserve forward.

- [x] **Remove standing recovery authority for accidental transfers and surplus funds.**
  `recoverUntrackedStrato`, `recoverStrayToken`, `recoverUnattributedFees` are gone;
  `untrackedStrato()` only reports.

- [x] **Verify complete, funded balances and historical earnings.** `reconcileRewardReserve`
  (lowers an unbacked reserve only), `_payRewards`' principal-and-reserve guard, the retired
  schedule's one-time settlement and the legacy unbonding queue are kept and tested; the runbook
  verifies the figures across the swap.

- [x] **End future earnings at the effective end of qualifying service or eligibility.**
  `_earns` requires seated, indexed, listed and eligible; a retained seat (deferred departure,
  the last validator) earns nothing; incumbents' exemptions honoured.

- [x] **Require seven days' notice for commission increases, independently of withdrawal
  timing.** `NOTICE_SECONDS` replaces `unbondingSeconds` in `setCommissionBps`; cuts are
  immediate; `setValidatorCommissionBps` is gone; a ceiling change touches only income credited
  after it (credits are split at credit time).

- [x] **Limit quality-control authority to accountable, evidence-based exclusions.** Registry:
  `announceRemoval(grounds)` → week → `removeValidator`, `emergencyRemove(validator, grounds)`,
  `cancelRemoval`; `adminSetOperator` and `emergencyKick` gone; a third of the stake is not
  grounds. Process details: decision 5.

- [x] **Allow two ordinary membership changes per block, including one replacement.**
  `MAX_SET_MUTATIONS_PER_BLOCK = 2`, a replacement consumes two, removals (ordinary and
  emergency) consume one and no longer bypass; `EVICTION_MARGIN_BPS = 500` on total bonded stake.

- [x] **Require a safe handover for membership and significant stake changes.** The safe-set
  rule (`readyWeight`, `_requireNotLessSafe`) runs after every set and weight mutation,
  emergency removals included; deferral is a revert to retry. Headroom and freshness: decision 6.

- [x] **Remove arbitrary calendar holds on exit, principal withdrawal and repeated delegation
  moves.** `exit` is immediate under the safe-set rule; `unstake` / `unbondSelf` pay principal in
  the same transaction; `moveStake` has no lock; the only waits are the week before a position
  earns (decision 3) and the week's notices.

- [x] **Require coordinated handover or shutdown for the final functioning validator's
  departure.** The last validator cannot `exit` (governance keeps it), nothing invents weight,
  its seat earns nothing once ineligible, and its funds come back at once. Process: decision 8.

- [x] **Require authorized, qualified operator handover with seven days' notice.** The key's
  `setOperator` binds in the registry and announces in staking; `acceptOperator(validator,
  bond)` completes a week later with the incoming operator's own bond; the outgoing operator is
  paid and refunded; delegations stay; binding back withdraws.

- [ ] **Verify failure and recovery outcomes and measure rounding losses.** The suites cover
  failed actions leaving nothing behind, repeated claims, the mutation-budget deferral, the
  safe-set deferral, the gap cap and index rounding, but they have not been run (see the status
  note above). Node-side agreement on accepted state is unchanged by this branch.

- [x] **Update the decision list, flows and rollout instructions to the resolved policies.**
  `staking-admission-and-rewards-decisions.md` (new), `staking-phase-2-design-decisions.md`
  (D16–D23), `staking-consensus.md`, `techdocs/platform/consensus.md`, the Upquark runbook,
  `staking-setup.js`, and the staking page's variable-yield wording.

## Tasks generated by the decisions

- [ ] **Run the SolidVM suites** (`solid-vm-cli test` on `StratoStaking.test.sol`,
  `ValidatorRegistry.test.sol`, `FeeRouter.test.sol`) and `solid-vm-cli analyze` on the
  contracts, and fix what they find. This revision's suites were written blind; expect SolidVM
  dialect corrections (for example around `override` on a public view, string comparison of a
  public `string` mapping getter, and zero-argument `User.do` calls).

- [ ] **Node: adopt the "published zero is an entry" rule** (decision 2) in
  `ProposerSelection.stakeWeights` and verify `Delta.hs` / `BlockHeaderV3.currentStakes` keep
  explicit zeros, on top of #7649 and #7650; add a `StakingConsensusSpec` case for a set with
  one zero-weight member after a complete vector. *Dependency; node change.*

- [ ] **Validator hosts: readiness acknowledgement** (decision 1). Add to the node's operator
  tooling (next to `strato-authorize-operator`) a one-off `acknowledgeReadiness()` transaction
  from the validator key for a candidate about to activate, and document it in the validator
  operations guide; a seated validator keeps ready by producing blocks.

- [ ] **Indexer or app job: touch due positions** (decision 3). `qualifyStake(user, validator)`
  is permissionless; a periodic job (or the staking page's "Start earning" button, which this
  revision adds) should touch positions whose week has run so delegators do not lose income to
  an untouched qualification.

- [ ] **Confirm the launch inputs** (runbook §0): the agreed block, the reserve allocation
  (10,000,000 STRATO proposed) and funder, the start, the quality-control approvers, and the
  disposition of the STRATO the legacy router holds.

- [ ] **Gas-fee revision and router cleanup** (task 11's dependency): STRATO gas to the fee sink
  including STRATO bought with USDST, and removal of `FeeRouter`'s dead `payBlockRewards` and
  `proposerFeeBps` paths (both already pay nothing against this staking contract).

- [ ] **Bind proxy logic swaps to validator approval** (decision 8): an AdminRegistry /
  governance change so that `setLogicContract` on the staking and registry proxies executes only
  with the published approval of validators holding more than two thirds of the consensus
  weight. Until then the process is procedural; publish it with the quality-control approvers.

- [ ] **Publish a trusted chain reference with each coordinated height** (decision 7): add the
  head hash to the release and `stakingActivationBlock` announcements so stale or new nodes can
  anchor their sync; no on-chain change.

- [ ] **Helium rehearsal of the in-place upgrade**: run the runbook on Helium (swap, reconcile,
  readiness acknowledgement and activation of one new validator, agreed block, fund, commit, a handover, an ordinary and
  an emergency removal, a liveness removal), checking every "Verify" line, before Upquark.

- [ ] **Rollout note on `processBlock` logging**: after the swap the node logs "no block
  rewards paid by …" every block (the router's `creditBlockReward` finding no function). Confirm
  the log level is acceptable or lower it in the gas-fee revision.
