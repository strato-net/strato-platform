# Upquark: permissionless admission and the committed emission schedule

Deploys the `StratoStaking` logic from this branch behind the Upquark staking proxy
(`f30a022c…3988`), the `ValidatorRegistry` logic behind its proxy, and configures:

1. **Permissionless admission** — from an agreed block, anyone may seat a validator that holds
   at least 10,000 STRATO of its operator's own self-bond and whose validator key has sent a
   readiness acknowledgement within the last day, into a free seat or by
   replacing the lowest validator it beats by 5%. Nobody, the owner included, seats anyone
   before that block. Seats held since before this logic keep the rule they were admitted under
   (self-bond plus delegations) until they leave or change operator; nothing expires that.
2. **The committed emission schedule** — STRATO prefunded into the staking contract's reserve
   pays each finalised block's producer the formula `E = E0 × √(S / S0) × (R / R0)` a year for
   the interval the block closed (at most an hour of it), `S` being the stake behind the earning
   set and `R` the reserve still unreleased. Committed once, after the reserve is funded; no
   pause, restart, re-calibration or recovery exists afterwards.

Only the staking and registry logic change. `MercataGovernance`, `FeeRouter` and the node are
untouched. The schedule rides on the `processBlock()` hook the router already calls every
transaction; the router's flat block reward and proposer fee share end because the staking
contract no longer answers `creditBlockReward` / `proposerFeeBps` (the router catches both and,
by its own design, pays nothing and routes the whole fee to the fee sink).

"Vote" = an AdminRegistry issue (`castVoteOnIssue`); run the command once per admin, two votes
execute. All commands run from `app/contracts/deploy` with the usual `.env` (`NODE_URL`, OAuth
client, `GLOBAL_ADMIN_NAME` / `GLOBAL_ADMIN_PASSWORD`) **and** the Upquark addresses:

```sh
export STAKING_PROXY=f30a022ce83bed7adeafc286c719388dcc3b3988
export VALIDATOR_REGISTRY_PROXY=d190674c0923a4646746b298037507bb9fc1057f
export STRATO_TOKEN=2ca3e170e6714282da77815f7864b17f612f5f83
```

(`staking-setup.js` and `deploy-staking.js` default to helium without them.)

## 0. Launch inputs (record before step 3; these are values, not policy)

| Item | Resolved policy | Value used |
|---|---|---|
| Admission opens at block | an agreed height after the consensus fixes (#7649, #7650) are live and the full stake vector is published | `JOINS_FROM = ______` |
| Incumbent cutoff | every validator seated at the logic swap keeps its exemption; the seated set at that block is the incumbent list | record `activeValidators` at the swap |
| Self-bond minimum | 10,000 STRATO of the operator's own, constant in the contract | `MIN_SELF_BOND` (no vote) |
| Notices, qualification, reentry | seven days, constant | `NOTICE_SECONDS` (no vote) |
| Readiness evidence | a key acknowledgement within a day, or a produced block within 500 blocks | `READINESS_WINDOW_SECONDS`, `READINESS_WINDOW_BLOCKS` (no vote) |
| Formula | `E = E0 × √(S / S0) × (R / R0)` per finalised block, at most an hour per block | as implemented |
| Calibration | 500,000 STRATO/year at 5,000,000 STRATO of earning stake with the initial reserve | `E0 = 500000000000000000000000`, `S0 = 5000000000000000000000000` |
| Initial reserve `R0` | 10,000,000 STRATO proposed; confirm the allocation before funding | `R0 = ______` (wei) |
| Funding account | project funds, separate from stakers' deposits and owed rewards | `FUNDER = ______` |
| Rewards start | at or after funding and the consensus activation; nothing is back-paid | `START = ______` (unix seconds, `0` = at the vote) |
| Legacy router balance | whatever STRATO the Upquark router holds stays there (it has no withdrawal and the staking contract no longer accepts its reward); its disposition is a separate, public decision | record the balance |
| Quality-control account | the AdminRegistry admin set (collective, two votes); approvers listed publicly | `______` |

The contract stores calibration, not policy: every rule above is a constant, and a change of
any of them is a logic upgrade under the network's extraordinary process (see
`techdocs/design-docs/staking-admission-and-rewards-decisions.md`, decision 8).

## 1. Before: record and verify the state

```sh
curl -s "$NODE_URL/bloc/v2.2/contracts/StratoStaking/$STAKING_PROXY/state" > upquark-staking-before.json
curl -s "$NODE_URL/bloc/v2.2/contracts/MercataGovernance/0000000000000000000000000000000000000100/state" > upquark-governance-before.json
curl -s "$NODE_URL/strato-api/eth/v1.2/block/last/1" > upquark-head-before.json
```

Check, and stop if any of these does not hold — this branch assumes V2 is live and activated:

- the staking state has `tryActivate` and `activeValidators` (V2 logic), and
  `activeValidators` holds exactly governance's `validators` (same members, no duplicates), every
  one with `isValidator` true (the set is indexed; if not, `node staking-setup.js index` with the
  full current set in `VALIDATORS` **before the commitment**: a seated validator left out of
  the index is paid nothing for the blocks it produces);
- `governanceSyncEnabled` is `true`, governance `stakingContract` is the staking proxy, and
  `validatorStake` matches `lastSyncedWeight` for every validator;
- `maxActiveValidators`, `hardCapActiveValidators`: write them down. Every other admission
  parameter the previous logic had (`minStake`, `selfBondGraceUntil`, `evictionMarginBps`,
  `maxSetMutationsPerBlock`, `exitNoticeSeconds`, `unkickCooldown`, `maxOperatorStakeBps`,
  `joinsPaused`, `unbondingSeconds`, `proposerFeeBps`) is dead storage under the new logic;
- `stakingActivationBlock` on the validators' `ethconf.yaml` vs. `upquarkStakingForkBlock` in
  `Forks.hs` (2,000,000): every validator must run with both at the same height before the
  lower of the two, and the headcount-until-complete rule (#7649) and the full-vector
  bootstrap (#7650) must be merged and live first;
- pending `unbondingQueue` requests: they stay withdrawable (at once) under the new logic.

The staking page's `/staking/info` shows the same numbers (`contractVersion`, `joinsOpen`,
`minStake`, `consensusWeight`, `readyWeight`).

## 2. Deploy the new logic (votes)

```sh
node deploy-staking.js gen staking
node deploy-staking.js gen registry
# Admin A: first create vote
node deploy-staking.js deploy staking
# Admin B: executes the create, prints the logic address, casts the first setLogicContract vote
node deploy-staking.js deploy staking
# Admin A: second vote executes the swap
node vote-setlogic.js $STAKING_PROXY <logic address>
# the same three steps for the registry
node vote-setlogic.js $VALIDATOR_REGISTRY_PROXY <logic address>
```

Record the **previous** logic addresses from both proxies before the swaps (`logicContract` in
each proxy's state).

Verify:

- `commitEmissionSchedule`, `fundRewardReserve`, `acknowledgeReadiness`, `exit`,
  `removeForMissedProposals`, `qualifyStake`, `acceptOperator`, `readyWeight`, `eligibleStake`
  appear in the staking contract's bloc function list; `tryActivate` still does (the app detects
  V2 by it); `creditBlockReward`, `proposerFeeBps`, `recoverUntrackedStrato`,
  `recoverStrayToken`, `recoverUnattributedFees`, `setEmissionSchedule`, `setValidatorParams`,
  `setSelfBondGraceUntil`, `settleValidators`, `requestExit`, `cancelExit` do not;
- `announceRemoval`, `cancelRemoval`, `emergencyRemove` appear in the registry's list;
  `adminSetOperator`, `emergencyKick`, `setEmergencyKicker` do not;
- `validatorCount`, `isValidator`, `lastSyncedWeight`, `delegatedStake`, `totalUserStake`,
  `totalSelfBond`, `totalRewardableStake`, `allocatedRewardLiability` identical to step 1;
- governance state identical to step 1 (no `ValidatorAdded` / `ValidatorRemoved` /
  `ValidatorStakeUpdated` events);
- `seatedUnderSelfBondRule` reads false for every seated validator (they are the incumbents);
  `joinsOpenFromBlock` reads `0` (closed) unless it was voted earlier, `emissionStartTime` `0`;
- `rewardReserve` is not new: the retired schedule kept its own under that name, and the logic
  in between dropped the field and let the owner of the day take the STRATO behind it, so the
  proxy may read a reserve nothing backs, against which every claim fails with
  `SS: rewards unavailable`. Right after the swap run `node staking-setup.js reconcile`
  (direct, permissionless: `reconcileRewardReserve()` only ever lowers the reserve to what the
  contract holds beyond principal and `allocatedRewardLiability`, and moves nothing), then
  verify `rewardReserve` reads as exactly that amount and that a test `claimOperatorRewards` /
  `claimRewards` of some pending amount succeeds before anything is funded;
- `untrackedStrato()` is what the old `recoverableUntrackedStrato()` read: nobody can take it;
- the chain keeps committing; `lastProcessedBlock` keeps advancing, `lastBlockTime` /
  `previousBlockTime` start filling (production income needs two processed blocks on record
  before the first paid one); the node logs "no block rewards paid by …" once per block, which
  is the router's `creditBlockReward` call finding no such function — expected.

Storage is keyed by name and the contracts keep their names and every historical field, so the
swaps are consensus-neutral: no set or weight changes.

## 3. Admission (one vote)

1. **Incumbents**: nothing to do. Each seated validator keeps qualifying on self-bond plus
   delegations for as long as it holds its seat under the same operator. No deadline, no
   mass bonding. A seat that leaves (exit, replacement, removal, liveness removal) or changes
   operator comes back only with 10,000 STRATO of self-bond.
2. **Readiness**: tell every operator that a candidate's validator key must send
   `acknowledgeReadiness()` from the node within the day before it activates, and that a
   seated validator stays "ready" by producing blocks (a finalised proposal is good for 500
   blocks; an acknowledgement is the fallback for a day). Seated validators without fresh
   evidence are "unready": the set can still change, but a change that would lower the ready
   share below 75% of the set's weight is deferred until evidence arrives.
3. **Agreed block**: `node staking-setup.js joinsfrom $JOINS_FROM`. Until that block only
   governance's own admin vote changes the set; from it on anyone calls `tryActivate(v)` /
   `reconcileSet([...])` for an eligible, ready validator. Movable by another vote until it
   passes; never closed again (no pause exists).
4. **Set size**: `node staking-setup.js setparams` votes `setSetParams(50, 50)` if the current
   values differ. The hard cap only lowers.

Verify: `joinsOpenFromBlock == JOINS_FROM`, `/staking/info.joinsOpen` flips to `true` once
`lastProcessedBlock >= JOINS_FROM` (before it `tryActivate` fails with `SS: joins not open`); a
registered, self-bonded validator whose key has acknowledged within the day reads `isWaiter`
and activates itself through the staking page; `ValidatorSynced` and governance
`ValidatorAdded` / `ValidatorStakeUpdated` follow; `readyWeight()` rises as validators
acknowledge or propose.

## 4. Emissions

1. **Fund the reserve** (direct transactions by `FUNDER`, which must hold the STRATO; set
   `GLOBAL_ADMIN_NAME` / `GLOBAL_ADMIN_PASSWORD` to that account for this step):
   `node staking-setup.js fundreserve $R0` — approves the staking proxy, then
   `fundRewardReserve(R0)`. Anyone may fund the reserve; nothing can take it back out, under
   this logic or any exceptional change (see §6). It reconciles first (step 2), so the deposit
   lands on the backed reserve. Verify `rewardReserve == previous backed value + R0`,
   `untrackedStrato() == 0`, a `RewardReserveFunded` event.
2. **Commit the schedule** (vote): `node staking-setup.js commit $E0 $S0 $R0 $START`
   → `commitEmissionSchedule(e0, s0, r0, startTime)`. It requires `rewardReserve >= r0`: what is
   advertised is funded. With `START = 0` the schedule starts at the block the second vote
   executes in; a future `START` schedules it. Nothing is paid for blocks before the start. The
   vote fails with `SS: schedule committed` if one exists: there is no second commitment.
3. **Verify** after the start: `ProductionRewarded(validator, amount, elapsed, stake, reserve)`
   once per finalised block whose producer is seated, listed and eligible; `rewardReserve`
   falling and `totalEmitted` / `allocatedRewardLiability` rising by the same amounts;
   `eligibleStake()` equal to the sum of seated, listed, eligible validators' `selfBond +
   delegatedStake`; `elapsed` never above 3600; a validator removed by governance vote leaving
   the staking set and unpaid from the next block (no `syncValidator` needed); the staking
   page's "Expected APY" and "current rate" reflecting `emissionAnnualRate()`. At the proposed
   calibration with `S = 5,000,000` and a full reserve the rate is 500,000 STRATO a year, and
   250,000 at `S = 1,250,000`; what a year actually releases is that rate times the share of
   the year covered by block intervals of an hour or less, less the reserve's decay as it is
   released (with a block every six minutes around the clock, about 487,700 STRATO the first
   year; a quiet chain releases less). This variable, production-based yield is the accepted
   shape of the schedule.
4. **Top-ups**: `fundreserve` again, any time. `R` rises, `R0` and past earnings do not change.
   There is no pause and no re-calibration.

Validators and delegators claim through the existing `claimRewards` / `claimOperatorRewards`
calls and the staking page. A delegation or self-bond placed after the swap earns from the week
after it was placed and from its next touch (`qualifyStake`, the page's "Start earning", or any
stake action); positions that predate the swap earn at once. Principal comes back in the same
transaction as `unstake` / `unbondSelf`.

## 5. Quality control: removals and handovers

- **Ordinary removal**: `node staking-setup.js announceremoval <validator> <grounds>` (vote;
  grounds are published in `RemovalAnnounced`), then after seven days
  `node staking-setup.js removevalidator <validator>` (vote). `cancelRemoval` withdraws an
  announcement. The removal is a membership change like any other: two per block, and never
  one that leaves the set unable to finalise on its ready members (it then fails with
  `SS: unsafe transition`; retry when evidence arrives or after removing an unready member).
- **Emergency**: `node staking-setup.js emergencyremove <validator> <grounds>` (vote) names one
  validator and its grounds and executes at once, under the same per-block and readiness rules.
- **Liveness**: `node staking-setup.js removeformisses <validator>` (direct, anyone) once
  `consecutiveMisses[v] >= 20`; the validator may be seated again a week later on fresh
  evidence. The staking admin tab offers the same button once the limit is reached.
- **Handover**: the validator key binds the new operator in the registry (`setOperator` with its
  signature, as today); the new operator completes it a week later with
  `acceptOperator(validator, bond >= 10,000 STRATO)` (staking page "Accept"). Until then the old
  operator operates and is paid out at completion; delegations stay. The key binds back to
  withdraw. There is no admin path that moves a validator.
- Holding more than a third of the stake is not grounds for anything on its own.

## 6. Rollback

- Admission: there is none. `joinsOpenFromBlock` cannot be moved once passed. Reverting the
  logic is the only way to close admission and is an extraordinary change.
- Emissions: there is no pause. The reserve is dedicated, under this logic and any other: a
  downgrade to a logic that could read it as untracked and recover it is excluded by policy
  (task 14 of the change list) and must not be voted. If the logic ever has to be reverted for
  a defect, the reverting logic must carry the reserve, the qualification state and the
  pending handovers forward; it cannot be the previous logic on this branch's base. Record
  `allocatedRewardLiability`, `rewardReserve` and `principalBalance()` before any such step.
  Nothing is lazily settled under this logic (production income is credited per block), so a
  reverting logic reads every claim from the same fields this one writes
  (`pendingSelfBondRewards`, `pendingCommission`, `delegatorRewardPerStakeStored`,
  `pendingDelegatorRewards`).

## 7. Open items for the business owner

The decisions the code cannot make, all values rather than policy:

- the values in the table in §0 (reserve size and funder, start, agreed block, the
  quality-control approvers);
- the disposition of the STRATO the legacy router still holds (it keeps paying nobody);
- the gas-fee revision (STRATO gas to the fee sink, STRATO bought with USDST) and the router
  cleanup that goes with it are a separate change this branch depends on but does not make;
  under this logic gas already goes wholly to the fee sink;
- the node-side rule for incomplete voting information after the bootstrap (decision 2): a
  separate node change on top of #7649 / #7650, specified in the decisions document.
