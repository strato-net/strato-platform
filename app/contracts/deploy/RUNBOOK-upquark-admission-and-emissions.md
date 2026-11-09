# Upquark: permissionless admission and the emission schedule

Swaps the `StratoStaking` logic behind the Upquark staking proxy (`f30a022c…3988`) for this
branch's and turns on two things. `MercataGovernance` gains `publishValidatorStakeSnapshot()`
(step 5); `ValidatorRegistry`, `FeeRouter` and the node are unchanged. Rehearse every step on
helium first (same commands without the exports).

1. **Staking by right from an agreed block.** From `joinsOpenFromBlock` anyone may seat
   (`tryActivate` / `reconcileSet`) a listed validator whose operator holds
   `selfBondMinimum` of its own self-bond (10,000 STRATO until the admins vote another value);
   delegations add weight but never qualify a new seat. Before that block nobody can seat
   anyone, the owner included, and there is no pause after it. Every seat held at the swap keeps the rule it was admitted under
   (`minStake`, with `selfBondGraceUntil`) until it leaves the set or changes operator.
2. **The emission schedule.** STRATO prefunded into the staking contract's `emissionReserve`
   pays each block's producer `E = E0 × √(S / S0) × (R / R0)` STRATO a year for the interval its
   block closed (at most an hour), split like the block reward. `S` is the consensus set's
   weight, `R` the reserve left. Committed once: no pause, no re-calibration, and neither
   `recoverUntrackedStrato` nor reward claims can reach the reserve.

"Vote" = an AdminRegistry issue; run the command once per admin, two votes execute. Commands run
from `app/contracts` with the usual `.env` and:

```sh
export STAKING_PROXY=f30a022ce83bed7adeafc286c719388dcc3b3988
export STRATO_TOKEN=2ca3e170e6714282da77815f7864b17f612f5f83
```

## 0. Launch inputs (decide before step 2)

| Item | Value |
|---|---|
| Agreed opening block | `JOINS_FROM = ______` (after step 5's bootstrap) |
| Self-bond minimum for new seats | 10,000 STRATO by default; to change it, `node deploy/staking-setup.js selfbondmin <amountWei>` (vote) |
| Rate at the reference point | `E0 = ______` wei a year (proposed: 500,000 STRATO = `500000000000000000000000`) |
| Reference stake | `S0 = ______` wei (proposed: 5,000,000 STRATO = `5000000000000000000000000`) |
| Reference reserve, funded before the commitment | `R0 = ______` wei |
| Reserve funder (holds the STRATO) | `FUNDER = ______` |
| Start | `START = ______` unix seconds (`0` = when the vote executes) |
| USDST fee share to proposers | `0` (gas fees are not validator income); voted in step 3 |
| FeeRouter flat block reward (0.01 STRATO a block, paid while the router holds STRATO) | none: this logic refuses it (`creditBlockReward` is disabled), so stop funding the router |

## 1. Before the swap: record and check

```sh
curl -s "$NODE_URL/bloc/v2.2/contracts/StratoStaking/$STAKING_PROXY/state" > upquark-staking-before.json
```

Stop unless all of these hold (this branch assumes staking V2 is live on Upquark):

- `governanceSyncEnabled` is `true` (or already off for step 5) and `activeValidators` holds
  exactly governance's validators, each with `isValidator` true. If the index is short, run
  `node deploy/staking-setup.js index` first, with the link on: it indexes governance's whole set
  and reverts if governance lists a validator staking has not seated. An unindexed seat is left
  out of `S`.
- Record `activeValidators`: these are the incumbents. Record `minStake` and `selfBondGraceUntil`
  as well, and do not change them for this rollout: they are now the incumbents' rule only.
- Record `proposerFeeBps`, `maxConsecutiveMisses`, `jailCooldown` (step 3 re-submits them).

## 2. Swap the logic (votes)

```sh
node deploy/upgrade.js --proxy-address $STAKING_PROXY --contract-name StratoStaking --contract-file BaseCodeCollection.sol +OVERRIDE-CHECKS
```

Verify against `upquark-staking-before.json`:

- `validatorCount`, `isValidator`, `lastSyncedWeight`, `delegatedStake`, `totalUserStake`,
  `totalSelfBond`, `totalRewardableStake`, `allocatedRewardLiability` unchanged; governance shows
  no `ValidatorAdded` / `ValidatorRemoved` / `ValidatorStakeUpdated` from the swap.
- `seatedUnderSelfBondRule` reads false for every incumbent; `joinsOpenFromBlock`,
  `selfBondMinimum`, `emissionReserve` and `emissionStartTime` read 0 (a `selfBondMinimum` of 0
  means 10,000).
- The chain keeps committing and `lastProcessedBlock` keeps advancing.

Then swap the governance logic at `0x100`, which adds `publishValidatorStakeSnapshot()`:
`node deploy/gen-governance-source.js` once, then `node deploy/deploy-governance.js` once per
admin. Verify that the validator list, every `validatorStake` and `stakingContract` are unchanged.

## 3. Fee share (vote)

In the admin tab's "Validator parameters", keep the pre-filled incumbent min stake and liveness
values, set the proposer fee share to 0 and save. That votes `setValidatorParams(minStake, 0,
maxConsecutiveMisses, jailCooldown)`. Verify `proposerFeeBps == 0`; from then on the whole USDST
fee goes to the fee collector.

## 4. Fund and commit the emission schedule

1. **Fund** (direct transactions by the funder; set `GLOBAL_ADMIN_NAME` /
   `GLOBAL_ADMIN_PASSWORD` to that account): `node deploy/staking-setup.js fundreserve $R0`
   approves the proxy, then calls `fundEmissionReserve`. Verify `emissionReserve == R0` and
   `recoverableUntrackedStrato()` unchanged from before the funding.
2. **Commit** (vote): `node deploy/staking-setup.js emission $E0 $S0 $R0 $START`. It fails with
   `SS: reserve unfunded` unless the reserve holds `R0`, and with `SS: schedule committed` if a
   schedule exists. Verify `emissionStartTime`, `emissionRateE0`, `emissionStakeS0`,
   `emissionReserveR0`.
3. **Verify payouts** after the start: a `ProductionRewarded(operator, validator, amount, elapsed,
   stake, reserve)` per processed block whose producer is seated and eligible, with
   `amount == emissionAnnualRate() × elapsed / 31536000` at that block's `stake` and `reserve`;
   `emissionReserve` falling and `totalEmitted` and `allocatedRewardLiability` rising by the same
   amounts; `elapsed` never above 3600. The staking page's APY now includes these payouts.
   Validators and delegators claim with the existing claim calls.
4. **Top-ups**: `fundreserve` again at any time, by anyone. `R` rises; `R0` does not change.

## 5. Bootstrap the stake weights (around block 2,000,000)

Headers before block 2,000,000 carry no stakes, so the weights governance holds reach consensus
only through `publishValidatorStakeSnapshot()`, which re-emits all of them in one transaction;
until it lands every validator votes once. A weight published alone before it would make that
validator the first-round proposer at every height and a one-validator quorum. So staking's
governance link stays off from before the fork until the snapshot is in a header: while it is
off, staking makes no governance calls, and the snapshot is the only way a weight gets published.

1. **Dry run, before block 2,000,000** (direct, anyone), once every validator is seated with a
   weight and governance runs this branch's logic: `node deploy/staking-setup.js bootstrapstakes`.
   Its events are dropped before the fork, but it succeeds only if every governance validator has
   a stored weight above 0 (`Validator has no stake weight` otherwise). Fix a missing weight now,
   while the link is on.
2. **Link off, before block 2,000,000** (vote): `node deploy/staking-setup.js govsync off`.
   Verify `governanceSyncEnabled` reads `false`: a vote that opened a second issue instead of
   executing leaves the link on. Until the link is back on, governance keeps the weights and set
   it has (a validator that falls below its minimum keeps its seat until the resync), and no
   validator may be voted into governance: it would have no stored weight, and the snapshot
   would revert.
3. **Snapshot, after block 2,000,000** (direct, anyone): `node deploy/staking-setup.js
   bootstrapstakes`. For the block B that holds it, check
   `curl -s "$NODE_URL/strato-api/eth/v1.2/block?number=<B>"`: B's `stakeUpdates` lists every
   validator, and B+1's `currentStakes` lists every validator with a positive weight.
4. **Link on** (vote): `node deploy/staking-setup.js govsync on`, the second vote only once the
   snapshot checks out. It resyncs the set and publishes only the weights that moved while the
   link was off, so before the snapshot it would publish those alone. Verify
   `governanceSyncEnabled` reads `true`.

## 6. Open admission (vote)

`node deploy/staking-setup.js joinsfrom $JOINS_FROM` votes `setJoinsOpenFromBlock`. It can be
moved, by another vote, only to a later block and only until the block is reached. Pick a block
after step 5 has finished: until the snapshot is in a header the nodes vote by headcount, and a
seat bought at the minimum would count as much as any other.

If the admins want a self-bond minimum other than 10,000 STRATO, they vote
`node deploy/staking-setup.js selfbondmin <amountWei>` (`setSelfBondMinimum`) before the opening
block; a higher value later also drops seats taken under the rule whose operator holds less.

Verify: `joinsOpenFromBlock == JOINS_FROM`; before it `tryActivate` fails with
`SS: joins not open` for everyone; from it a validator whose operator self-bonded the minimum
shows as eligible on the staking page and seats itself (`ValidatorSynced`, then governance
`ValidatorAdded`); one with less self-bond, however much is delegated, stays ineligible.

## 7. Rollback

Swap back to the previous logic with the same `upgrade.js` vote only before step 4: from the
first funding on, the previous logic would count the reserve as untracked STRATO that
`recoverUntrackedStrato` can take. After step 4, any replacement logic must keep
`emissionReserve` out of recovery and payouts.
