# Staking admission and rewards: the eight open decisions, resolved

Companion to `staking-admission-and-rewards-tasks.md`, for
[PR #7639](https://github.com/strato-net/strato-platform/pull/7639). The commenter's specified
solutions are taken as given; this document picks the details those left open, says why, and
records what each choice depends on. Every number below is a constant in `StratoStaking.sol`,
not a parameter: changing one is a logic upgrade under decision 8.

Scope boundary: the policy lives in `StratoStaking`. `ValidatorRegistry` carries only the
edits that cannot live anywhere else (listed under "Contract edits outside StratoStaking").
The consensus (node) changes and the gas-fee revision are explicit dependencies, not changes
made here.

## 1. Readiness evidence before voting power — option B, the trial plus observed operation

**Chosen.** A candidate is seated only when all of these hold: its validator key has consented
to its operator (already required); its operator holds 10,000 STRATO of its own self-bond; and
the validator key itself has sent `acknowledgeReadiness()` transactions from the node for an
unbroken week, no two more than a day apart (`readySince` to `readyAt ≥ NOTICE_SECONDS`, every
gap `≤ READINESS_WINDOW_SECONDS`). A gap longer than a day restarts the run. Evidence older than a
day is stale. Once seated, a finalised proposal counts as an acknowledgement, so a producing
validator stays ready without extra transactions.

**Why this and not the bare trial.** On-chain, the only objective facts about a node are what
its key signs. A single signed transaction proves key control and that the node's vault and
transaction pipeline work at that moment, which is what the commenter said is insufficient.
A week of daily transactions proves the same thing sustained over the period in which every
other notice in the system runs, is checkable by anyone from state, and costs the candidate a
fee a day. It does not prove execution correctness; that is only ever proven by producing
finalised blocks, which is why the liveness rule (decision 5) removes a seated validator that
misses twenty proposals in a row. The trial filters nodes that are not reliably up; the
liveness rule removes nodes that cannot produce.

**Rejected.** A probation seat with reduced voting weight would show execution correctness
before voting power but needs separate proposer and vote weights in the block header: a
consensus change outside this branch.

**Values.** `NOTICE_SECONDS = 604800`, `READINESS_WINDOW_SECONDS = 86400`. Failure: any gap over
a day restarts the trial. Retry: at once. Evidence too old: after a day.

## 2. Incomplete voting information — option A, continue on the last complete distribution

**Chosen.** Weights are in force only when every member of the set has a published entry
(a published zero is an entry; a missing one is not). While they are, a member with zero stake
weighs zero, on neither side of the quorum. Until the first complete vector is published after
activation, the set votes by headcount (what #7649 does); #7650's snapshot publishes that first
complete vector, and admission does not open (`joinsOpenFromBlock`) before it has. After that,
headcount never returns: a seated validator whose stake falls to zero is a zero-weight member,
not a trigger for equal votes.

**Contract side (this branch).** The staking contract publishes a weight for every seated
validator whenever it changes (`_syncValidator` publishes unconditionally), including zero; it
never seats a validator without publishing; and it never removes a validator without
governance removing it in the same transaction, so the set and the vector move together.
`joinsOpenFromBlock` is the gate: the runbook sets it after the snapshot block.

**Node side (dependency, on top of #7649 and #7650).** `stakeWeights` in
`strato/core/strato-model/src/Blockchain/Strato/Model/ProposerSelection.hs` must treat a set
as weighted when every member has an entry in the stake map, rather than when every entry is
positive, and `Delta.hs` / the header's `currentStakes` must keep explicit zero entries. With
that, a transition whose vector cannot be verified never silently falls back: the verifier's
existing `StakeMismatch` rejection holds the block, which is the "stop finalisation" branch of
option B, reserved for a genuinely corrupt vector. These lines are owned by #7649 and are
specified here rather than edited, to avoid conflicting with it.

## 3. Rewards without payout chasing — option A, a week before a position earns

**Chosen.** Every delegation and every self-bond earns only once it has been in place for
`NOTICE_SECONDS`. The clock is the stake-weighted average placement time of the position, so a
small top-up barely moves it and a top-up the size of the position restarts half the week; a
move to another validator restarts it in full; a partial withdrawal keeps the remainder's
clock. While a position waits it votes with its full weight and earns nothing: a block's
income is split between the operator's qualified self-bond and the qualified delegations
(commission on the delegations' share only), and if nothing on the record qualifies the
block's share stays in the reserve. Positions that predate the upgrade are qualified from the
start (their waiting amount is unset).

**Why a week kills chasing.** Proposers are predictable from the weights, so a delegator who
could move onto the validator due to produce the next block and move off again would collect a
certain block instead of an expected one. With a week's wait, a move forgoes a week of income
(about 1,600 blocks' worth of expected share on a chain producing a block every six minutes)
to gain the luck of one validator over the following window. The best a chooser can do is pick
the validator that will be luckiest over that window, and the luckiest of fifty equal
validators over `n` blocks produces about `2.3·√n` blocks more than expected, against `n`
blocks forgone: the trade only breaks even past a window of six weeks, over which any stake
change by anyone reshuffles the schedule. So a chaser earns less than a holder. The remaining
exposure is the variance of honest production, which stake distribution already carries.

**Rejected.** Time-weighted allocation (option B) needs every position's age in every split,
which is unbounded per block on SolidVM; the combination (option C) adds that cost for no
further protection once a week's wait already makes chasing unprofitable.

**Consequences.** `moveLockedUntil` and `unbondingSeconds` are gone: moves are free, principal
comes back in the same transaction. Past earnings are settled on every change and remain
claimable after exit.

## 4. Missed or interrupted production — option A, uncredited time stays in the reserve

**Chosen.** Each finalised block pays its producer the formula's release for the interval the
block closed, capped at `MAX_CREDITED_GAP_SECONDS = 3600`. A gap longer than an hour (an outage,
a quiet night, a halted chain) pays one hour to the block that ends it, and the rest stays in
the reserve, where it only raises `R` for every later block. There is no catch-up, no
supplement and no first-caller windfall: the amount depends on block timestamps, not on when
anything is calculated or claimed, so identical block histories pay identically whenever they
are processed. A missed proposal pays the fill-in producer, not the one that missed. Blocks
before the committed start pay nothing, and an interval straddling the start pays only the
part after it.

**Why an hour.** It is the node's own definition of abnormal (`roundPeriodS = 3600` is its
backstop after an hour without a block). On the observed cadence (a block every few minutes)
nearly every block is credited in full; a sparse chain is paid for the service it actually
rendered, which is what the commenter asked for.

**Empty blocks.** STRATO produces none (a block exists only for a transaction), so the question
does not arise; if the node ever produces them, they are finalised production like any other.

**Rejected.** Gradual recovery (option B) pays later producers for time nobody served and makes
the amount depend on a schedule rather than on production.

## 5. Fault-based removal and reentry — option A, predetermined faults and procedures

**Chosen.** Three paths, each bounded by the same two-per-block churn rule and the readiness
rule of decision 6:

- *Liveness, permissionless:* `removeForMissedProposals(v)` once `consecutiveMisses[v] ≥ 20`.
  The evidence is on chain and anyone may act on it. The validator keeps its stake, may be
  seated again a week later, and must pass a fresh readiness trial first.
- *Ordinary removal, by the quality-control account:* `ValidatorRegistry.announceRemoval(v,
  grounds)` publishes the grounds in an event and starts a week's notice;
  `removeValidator(v)` executes after it; `cancelRemoval(v)` withdraws it. Relisting needs
  the same account, after a week, under the operator the validator had.
- *Emergency, by the same account:* `emergencyRemove(v, grounds)` names one validator and its
  grounds and executes at once. No list, no blanket authority.

The quality-control account is the registry's owner, which on Upquark is the AdminRegistry's
admin set acting by two votes: the collective approval the commenter asked for. Holding more
than a third of the stake is not grounds for anything; the single-key `emergencyKick` and its
`exceedsOneThird` test are removed, as is the owner's unsigned `adminSetOperator`.

**Why twenty misses.** A miss is counted only on a round change, and a locked block re-proposed
in a later round produces one false miss. Twenty in a row is unreachable by that artefact and
by ordinary bad luck, and because selection is stake-weighted it reaches a large validator in
hours and a small one in days, which is proportional to the liveness each one costs.

**Rejected.** A separately defined misconduct category (option B) adds judgment the on-chain
record cannot support; off-chain misconduct goes through the emergency path with grounds, or
through the extraordinary process if the account itself is the problem.

## 6. Readiness the resulting set must show — option A, a fixed cushion

**Chosen.** After any change to the set or to a seated validator's weight, the resulting set
must either be *safe*, meaning strictly more than two thirds of its weight is ready and at
least `READY_WEIGHT_BPS = 7500` (three quarters) of it is, or the change must not have lowered
the ready share. "Ready" is fresh evidence under decision 1 (an acknowledgement or a finalised
proposal within a day). Applied uniformly to exits, replacements, removals of every kind,
handovers, stakes, moves, unstakes and self-bond changes; a change that fails is deferred (the
transaction reverts with `SS: unsafe transition`) and can be retried once evidence arrives or
once an unready member has been removed. Removing an unready member, or adding a ready one,
never lowers the share and always passes. A set with no evidence at all (every seat an
incumbent on a quiet chain) is not made worse by any change, so nothing is deferred until
evidence starts arriving. Changes in one block are assessed cumulatively, since each sees the
state the previous one left.

**Why three quarters and not a failure-tolerance rule.** A rule of the form "still finalises
after one more member fails" is unsatisfiable in the small sets Upquark and Helium run (with
four equal members no exit is ever allowed); a fixed cushion of one twelfth above the quorum
threshold is simple, consistent and leaves room for one small member to go quiet.

**If safe departure is impossible** (the only ready members are the ones that want to leave),
the rule itself points at the resolution: remove the unready members for liveness, which
always passes, and then leave. The last validator cannot leave through the contract at all
(governance keeps it), which is decision 8's coordinated handover.

## 7. Trustworthy history after validators leave — option A, existing rules, no new hold

**Chosen.** No withdrawal hold is added. Under this logic principal is paid in the same
transaction and a validator's keys lose their consensus authority the block after it leaves.
The existing history rules stay: a syncing node verifies every historical block's commit seals
against the validator set and weights its parent header carries (`replayHistoricBlock`), and
the network's peers and bootnodes are the trusted source of the head.

**What was investigated.** A long-range fork needs the keys of two thirds of a *past* set, kept
after their owners left. Holding those operators' STRATO for a period would not change that:
the keys are the node's, not the bond's, and a bond held for a week or a year is released
before any such fork would be attempted. So a holding period does not address the risk and is
not added. What does address it is a published trusted reference: the release and
`stakingActivationBlock` announcements already name heights the network agrees on, and the
rollout instructions ask operators to publish the head hash alongside each one so a stale or
new node has an anchor to check its sync against. That is option B's reference without a new
on-chain procedure. This remains an investigation finding, not a finding that STRATO is
vulnerable to a demonstrated attack.

## 8. Extraordinary intervention — option A, validator approval plus operator adoption

**Chosen.** The only ways the committed terms, inaccessible funds or a halted chain can change
are a logic upgrade of the staking or registry proxy and a node release, and both go through
this process: a public proposal naming the change and its grounds; a week's notice (the same
`NOTICE_SECONDS` as everything else); approval by validators holding strictly more than two
thirds of the consensus weight, signed by their validator keys and published; and explicit
adoption by node operators, which for a node change is the release with its activation height
and for a logic change is the two admin votes that execute the swap, cast only after the
validator approval is on record. For a halted chain, "approval" is the same signatures
collected off chain and "adoption" is operators restarting on the agreed release and height.
The quality-control account cannot widen its own powers through this: a change to its
membership or scope is itself a proposal under this process, and the committed reserve stays
dedicated through any change (the task list's rule 14).

**Why not stakeholder groups (option B).** They cannot be identified on chain and a process
that cannot say who approved is one that can be claimed by anyone; validators are identifiable,
weighted and already the parties whose adoption decides whether a change runs.

**Dependency.** Binding the proxies' `setLogicContract` to the validator approval (rather than
to the admin votes alone) is a governance/AdminRegistry change outside this branch and is
recorded as such; until it lands, the process is procedural and the admin set is accountable
for following it.

## Launch inputs

See the runbook's §0: the agreed block, the funder and the confirmed allocation (10,000,000
STRATO proposed), the reference reserve and the start, the quality-control approvers, the
legacy router balance and its separate disposition. The incumbent cutoff is the logic swap:
every seat held at the swap keeps its exemption and reads `seatedUnderSelfBondRule == false`.

## Contract edits outside StratoStaking, with their justification

| Edit (ValidatorRegistry) | Why it cannot be in StratoStaking |
|---|---|
| `IStratoStakingValidatorSync` loses `exceedsOneThird` | the staking contract no longer defines it; the registry must not call it |
| `emergencyKick`, `setEmergencyKicker`, `emergencyKicker` removed | they are the registry's single-key removal path; a third of the stake is not misconduct and one key is not collective approval (decision 5) |
| `adminSetOperator` removed | the registry owns the binding; the owner's unsigned reassignment is the registry's own power (task 19) |
| relisting keeps the operator | the same: a relisting under another operator was the last unsigned way to move a validator |
| `announceRemoval` / `cancelRemoval` / `removeValidator` gated / `emergencyRemove`, with grounds and events | delisting is the registry's responsibility; the grounds and the notice belong where the removal is executed (decision 5) |

Everything else (the handover's notice, bond and completion; readiness; qualification; the
schedule; the safe-set rule; the removal of every recovery, pause and bypass power) is in
`StratoStaking.sol`. `FeeRouter`, its genesis mirror and `MercataGovernance` are untouched; the
router's block reward and proposer share end because the staking contract no longer answers
them, which the router already handles.

## Explicit dependencies (not changed on this branch)

1. **Consensus:** #7649 (headcount until the vector is complete) and #7650 (full-vector
   bootstrap), then the node-side rule of decision 2 on top of them.
2. **Gas:** the separate gas-fee revision (STRATO gas to the fee sink, including STRATO bought
   with USDST) and the `FeeRouter` cleanup that removes the dead `payBlockRewards` and
   `proposerFeeBps` paths. Under this branch the router already routes the whole fee to the
   sink and pays no block reward, by its own catch paths.
3. **Governance:** binding the proxies' logic swaps to validator approval (decision 8).
