# Upquark: permissionless admission and the emission schedule

Deploys the `StratoStaking` logic from this branch behind the Upquark staking proxy
(`f30a022c…3988`) and configures two things:

1. **Permissionless admission** — an operator whose validator holds at least 10,000 STRATO of
   its own self-bond joins the consensus set with `tryActivate` / `reconcileSet` from an agreed
   block, under the existing capacity rules (50 seats, eviction margin, per-block mutation
   budget, operator stake cap). No per-applicant admin vote.
2. **The emission schedule** — STRATO prefunded into the staking contract's reserve is released
   automatically at `E = E0 × √(S / S0) × (R / R0)` a year across the stake behind the consensus
   set (`S`), `R` being the reserve still unreleased, and claimed like block rewards.

Only the staking logic changes. `ValidatorRegistry`, `MercataGovernance`, `FeeRouter` and the
node are untouched: the schedule rides on the `processBlock()` hook the router already calls
every transaction.

"Vote" = an AdminRegistry issue (`castVoteOnIssue`); run the command once per admin, two votes
execute. All commands run from `app/contracts/deploy` with the usual `.env` (`NODE_URL`, OAuth
client, `GLOBAL_ADMIN_NAME` / `GLOBAL_ADMIN_PASSWORD`) **and** the Upquark addresses:

```sh
export STAKING_PROXY=f30a022ce83bed7adeafc286c719388dcc3b3988
export VALIDATOR_REGISTRY_PROXY=d190674c0923a4646746b298037507bb9fc1057f
export STRATO_TOKEN=2ca3e170e6714282da77815f7864b17f612f5f83
```

(`staking-setup.js` and `deploy-staking.js` default to helium without them.)

## 0. Decisions this runbook needs (fill in before step 3)

| Item | Proposal on the table | Value used |
|---|---|---|
| Admission opens at block | an agreed height after every validator meets the self-bond rule | `JOINS_FROM = ______` |
| Self-bond minimum | 10,000 STRATO per validator key, self-bond only (no delegations) | `MIN_STAKE = 10000000000000000000000` |
| Self-bond grace deadline | a time after the incumbents have bonded (a past time applies at once) | `GRACE_UNTIL = ______` |
| Formula | `E = E0 × √(S / S0) × (R / R0)` | as implemented |
| Calibration | 500,000 STRATO/year at 5,000,000 STRATO of eligible stake with the initial reserve | `E0 = 500000000000000000000000`, `S0 = 5000000000000000000000000` |
| Initial reserve `R0` | 10,000,000 STRATO was illustrative | `R0 = ______` (wei) |
| Funding account | project funds, separate from stakers' deposits and owed rewards, minted before the final mint | `FUNDER = ______` |
| Rewards start | a time at or after reserve funding and V2 activation; nothing is back-paid | `START = ______` (unix seconds, `0` = at the vote) |
| Flat 0.01 STRATO block reward | leave the router unfunded (then it pays nothing) or keep funding it on top | `______` |
| Mutability | automatic under the existing admin powers: any value above can be re-voted, the proxy's logic can be swapped | accepted / `______` |

The contract stores calibration, not policy: a future change of formula is a logic upgrade; a
change of numbers is one vote.

## 1. Before: record and verify the state

```sh
curl -s "$NODE_URL/bloc/v2.2/contracts/StratoStaking/$STAKING_PROXY/state" > upquark-staking-before.json
curl -s "$NODE_URL/bloc/v2.2/contracts/MercataGovernance/0000000000000000000000000000000000000100/state" > upquark-governance-before.json
curl -s "$NODE_URL/strato-api/eth/v1.2/block/last/1" > upquark-head-before.json
```

Check, and stop if any of these does not hold — this branch assumes V2 is live and activated:

- the staking state has `creditBlockReward`, `tryActivate`, `activeValidators` (V2 logic), and
  `activeValidators` holds exactly governance's `validators` (same members, no duplicates), every
  one with `isValidator` true (the set is indexed; if not, `node staking-setup.js index` with the
  full current set in `VALIDATORS` **before any emission vote**: a seated validator left out of
  the index earns nothing from the schedule);
- `governanceSyncEnabled` is `true`, governance `stakingContract` is the staking proxy, and
  `validatorStake` matches `lastSyncedWeight` for every validator;
- `minStake`, `selfBondGraceUntil`, `joinsPaused`, `maxActiveValidators`,
  `hardCapActiveValidators`, `evictionMarginBps`, `maxSetMutationsPerBlock`,
  `maxOperatorStakeBps`: write them down. Decide which step 3 changes.
- `stakingActivationBlock` on the validators' `ethconf.yaml` vs. `upquarkStakingForkBlock` in
  `Forks.hs` (2,000,000): strato-net/strato-platform#7638 moves the ethconf default to 2,000,000
  as well; every validator must run with both at the same height before the lower of the two.

The staking page's `/staking/info` shows the same numbers (`contractVersion`, `joinsPaused`,
`minStake`, `selfBondGraceUntil`).

## 2. Deploy the new staking logic (votes)

```sh
node deploy-staking.js gen staking
# Admin A: first create vote
node deploy-staking.js deploy staking
# Admin B: executes the create, prints the logic address, casts the first setLogicContract vote
node deploy-staking.js deploy staking
# Admin A: second vote executes the swap
node vote-setlogic.js $STAKING_PROXY <logic address>
```

Record the **previous** logic address from the proxy before the swap (`logicContract` in the
proxy's state); it is the rollback target.

Verify:

- `setEmissionSchedule`, `fundRewardReserve`, `eligibleStake`, `setJoinsOpenFromBlock` appear in
  the staking contract's bloc function list; `creditBlockReward` still does (the app detects V2
  by it);
- `validatorCount`, `isValidator`, `lastSyncedWeight`, `delegatedStake`, `totalUserStake`,
  `totalSelfBond`, `totalRewardableStake`, `allocatedRewardLiability` identical to step 1;
- governance state identical to step 1 (no `ValidatorAdded` / `ValidatorRemoved` /
  `ValidatorStakeUpdated` events);
- new fields read as unset: `lastEmissionTime 0`, `joinsOpenFromBlock 0`. `rewardReserve` is
  not new: the retired schedule kept its own under that name, and the logic in between dropped
  the field and let `recoverUntrackedStrato` take the STRATO behind it, so the proxy may read a
  reserve nothing backs, against which every claim fails with `SS: rewards unavailable`. Right
  after the swap run `node staking-setup.js reconcile` (direct, permissionless:
  `reconcileRewardReserve()` only ever lowers the reserve to what the contract holds beyond
  principal and `allocatedRewardLiability`, and moves nothing), then verify `rewardReserve`
  reads as exactly that amount (0 on Upquark unless the retired schedule left backed tokens
  behind) and that a test `claimOperatorRewards` / `claimRewards` of some pending amount
  succeeds before anything is funded;
- the chain keeps committing; `lastProcessedBlock` keeps advancing (`processBlock` is still
  called every transaction and now also runs `_accrue`, a no-op until a schedule exists).

Storage is keyed by name and the contract keeps its name and every historical field, so the swap
is consensus-neutral: no set or weight changes.

## 3. Admission (votes)

1. **Self-bond minimum**, if `minStake` is not already 10,000 STRATO:
   `node staking-setup.js params` (edit `params` in the script if the other three arguments —
   `proposerFeeBps`, `maxConsecutiveMisses`, `jailCooldown` — must keep their current values).
2. **Incumbents**: for every validator in the set, confirm `operators[v].selfBond >= minStake`.
   Operators top up their own shortfall with `selfBond(validator, amount)` (staking page or
   direct call). Delegations do not count once the grace ends.
3. **Strict self-bond rule**: `node staking-setup.js grace $GRACE_UNTIL`. A past time applies
   it at once. Validators still under the bar leave the set on the next sync, at most
   `maxSetMutationsPerBlock` per block; `syncValidator(v)` is permissionless, so anyone can finish
   it. Governance never drops its last validator.
4. **Capacity rules**: `node staking-setup.js setparams` votes
   `setSetParams(maxActive, hardCap, evictionMarginBps, mutationsPerBlock, exitNoticeSeconds, unkickCooldown, maxOperatorStakeBps, joinsPaused)`
   — edit the script's `setparams` line to the agreed values with **`joinsPaused = false`**. The
   hard cap only lowers. `maxOperatorStakeBps` now bounds `reconcileSet` as well as
   `tryActivate`.
5. **Agreed block**: `node staking-setup.js joinsfrom $JOINS_FROM`. Until that block only the
   owner (an admin vote) can activate; from it on anyone can call `tryActivate(v)` /
   `reconcileSet([...])` for an eligible validator. Vote 4 and 5 ahead of the block, in either
   order; both must hold for a permissionless join.

Verify: `joinsPaused false`, `joinsOpenFromBlock == JOINS_FROM`, `/staking/info.joinsOpen`
flips to `true` once `lastProcessedBlock >= JOINS_FROM`; a registered, self-bonded validator
outside the set (`isWaiter`) activates itself through the staking page; `ValidatorSynced` and
governance `ValidatorAdded` / `ValidatorStakeUpdated` follow.

## 4. Emissions

1. **Fund the reserve** (direct transactions by `FUNDER`, which must hold the STRATO; set
   `GLOBAL_ADMIN_NAME` / `GLOBAL_ADMIN_PASSWORD` to that account for this step):
   `node staking-setup.js fundreserve $R0` — approves the staking proxy, then
   `fundRewardReserve(R0)`. Anyone may fund the reserve; nothing can take it back out. It
   reconciles first (step 2), so the deposit lands on the backed reserve. Verify
   `rewardReserve == previous backed value + R0`, `recoverableUntrackedStrato() == 0`, a
   `RewardReserveFunded` event.
2. **Set the schedule** (vote): `node staking-setup.js emission $E0 $S0 $R0 $START`
   → `setEmissionSchedule(e0, s0, r0, startTime)`. With `START = 0` accrual starts at the
   block the second vote executes in; a future `START` schedules it and can be moved by another
   vote until it passes. Nothing is back-paid before the start.
3. **Verify** after the start: `EmissionAccrued(amount, stake, reserve, elapsed)` once per block
   with transactions; `rewardReserve` falling and `totalEmitted` / `allocatedRewardLiability`
   rising by the same amounts; `eligibleStake()` equal to the sum of seated, listed validators'
   `selfBond + delegatedStake`; a validator removed by governance vote leaving the staking set
   and stopping accrual on the next block with transactions (no `syncValidator` needed); the
   staking page's APY and "current rate" reflecting `emissionAnnualRate`. The first year at the
   proposed calibration with `S = 5,000,000` and a full reserve releases 500,000 STRATO; with
   `S = 1,250,000` it releases 250,000; the rate falls in proportion to the reserve as it is spent.
4. **Pause / change**: `node staking-setup.js emission 0 $S0 $R0 0` pauses (the reserve stays);
   any later `emission …` vote resumes from that block, not from the pause. Re-calibration is
   the same vote with new numbers; it settles the running interval under the old numbers first.

Validators and delegators claim through the existing `claimRewards` / `claimOperatorRewards`
calls and the staking page; what the schedule owes a validator is credited on its next touch and
the page already includes it in pending amounts.

## 5. The flat block reward

`FeeRouter.payBlockRewards` still pays 0.01 STRATO per proposed block **only while the router
holds STRATO**. Leave the Upquark router unfunded for emissions to be the only automatic STRATO
income, or keep funding it (`node staking-setup.js fundrouter` with `FEE_ROUTER` set) to pay
both; `creditBlockReward` itself is unchanged. Whatever STRATO the router already holds keeps
being paid out until it runs dry (it has no withdrawal function).

## 6. Rollback

- Emissions: pause with `emission 0 …` (one vote). The reserve is untouched and stays in the
  contract; it is never recoverable under this logic, by design.
- Admission: `setparams` with `joinsPaused = true` (one vote), or `joinsfrom <far future block>`.
- Logic, in this order. The schedule credits a validator only when its record is settled, from
  indexes (`emissionPerStakeStored`, `emissionPerStakePaid`) the previous logic does not read:
  downgrading before step 2 strands whatever is unsettled, counted in `allocatedRewardLiability`
  (so protected from recovery) but claimable by nobody until a re-upgrade. The reserve is
  recovered under the previous logic, after the downgrade, never before.
  1. Pause: `node staking-setup.js emission 0 $S0 $R0 0` (one vote). Skip if already paused.
  2. Settle: `node staking-setup.js settle` (direct, permissionless) with every seated validator
     in `VALIDATORS`, in batches of at most `maxBatchSize`. Verify `emissionPerStakePaid[v] ==
     emissionPerStakeStored` for each one. What the schedule owed now lives in
     `pendingSelfBondRewards`, `pendingCommission` and `delegatorRewardPerStakeStored`, fields the
     previous logic pays.
  3. Record `allocatedRewardLiability`, `rewardReserve` and `principalBalance()`.
  4. Downgrade: `node vote-setlogic.js $STAKING_PROXY <previous logic address>` (two votes).
  5. Verify under the previous logic: `allocatedRewardLiability` and `principalBalance()` as
     recorded; a test `claimOperatorRewards` / `claimRewards` of some settled amount succeeds;
     `recoverableUntrackedStrato()` equals the recorded `rewardReserve` (the previous logic does
     not know the reserve, so it reads as untracked STRATO).
  6. The owner may now `recoverUntrackedStrato(FUNDER, <recorded rewardReserve>)` (vote), or
     leave the STRATO in place for a later re-upgrade, which then reads it as the backed reserve.

  By state: funded but not started — nothing is unsettled, only steps 3–6 matter and the reserve
  is what §4 funded; running — every step; paused — skip step 1; partially claimed — nothing
  special, what was paid is already out of the liability.

## 7. Open items for the business owner

The code treats every number above as configuration. The decisions it cannot make:

- the values in the table in §0 (reserve size and funder, start, agreed block, grace deadline);
- whether the flat block reward stays funded alongside emissions;
- whether the schedule must become immutable later (that is a separate change: renouncing or
  restricting the proxy owner's upgrade and parameter powers), or stays "automatic under admin
  configuration", which is what ships here;
- whether locked allocations (team, investors, treasury) may stake and so earn from the schedule
  — the contract pays every seated validator's stake alike and has no allowlist.
