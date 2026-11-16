# Upquark legacy staking migration before go-live

This is the prerequisite missing from
[the PR rollout](./RUNBOOK-upquark-admission-and-emissions.md). It upgrades the existing
staking and registry proxies in place. The migration implementations are temporary;
install the plain PR logic after migration and incumbent bootstrap. No on-chain action
has been taken by this worktree.

## 1. Prepare a complete one-shot call

Export fresh staking, registry and governance states from a **quiescent Upquark state**;
verify no relevant transaction changed any of them between exports and execution.
Do not use the investigation snapshots as deployment inputs. From `app/contracts`:

```sh
export STAKING_PROXY=f30a022ce83bed7adeafc286c719388dcc3b3988
export VALIDATOR_REGISTRY_PROXY=d190674c0923a4646746b298037507bb9fc1057f
export STRATO_TOKEN=2ca3e170e6714282da77815f7864b17f612f5f83
curl -fsS "$NODE_URL/bloc/v2.2/contracts/StratoStaking/$STAKING_PROXY/state" > staking-before.json
curl -fsS "$NODE_URL/bloc/v2.2/contracts/ValidatorRegistry/$VALIDATOR_REGISTRY_PROXY/state" > registry-before.json
curl -fsS "$NODE_URL/bloc/v2.2/contracts/MercataGovernance/0000000000000000000000000000000000000100/state" > governance-before.json
python3 deploy/prepare-upquark-migration.py --staking staking-before.json \
  --registry registry-before.json --governance governance-before.json > reviewed-plan.json
```

Review and freeze `reviewed-plan.json` for every voting admin. The 13 active mappings in
`deploy/upquark-operator-mapping.json` came from forktest block 388; verify each against
current Upquark node/registry records. The two inactive records use identity mappings
because their validator-key bindings were not verified. This preserves their accrued
claims, including pending base rewards, but leaves them as inactive profiles keyed by
their old operator addresses. Future relisting under other consensus keys needs a
verified mapping and separate path.

The preparer includes every nonzero principal, pending reward and checkpoint entry,
including users with **zero current stake**. It checks full legacy lists, final reward
schedule, distinct targets, totals, and protocol IDs. With the investigation snapshots
it yields 15 records and **109** user/operator entries, two zero-weight incumbents and
four governance validators without legacy records. Forktest's 13-record/107-position
shadow call is incomplete for current Upquark. Stop if any current state differs without
an explained mapping update.

Before production, rehearse against a clone of **actual** Upquark legacy proxy state and
the exact intended node release. The included unit tests seed a legacy-shaped fixture,
so they do not alone prove actual historical storage decoding. Verify the live ABI/source
field names and types, every migrated balance/checkpoint, and that each one-shot call
fits the transaction gas limit. Neither migration can be batched as written.

## 2. Install temporary logic and migrate all records

Use the existing `deploy/upgrade.js` vote flow for each proxy. The admin whose create
vote executes gets an implementation address and starts the set-logic vote; complete it
with `deploy/vote-setlogic.js`. Each owner call requires the live AdminRegistry threshold.
At Upquark block 990181, there were 8 admins and the default threshold was 50%, so a
default action needed 4 distinct votes; verify any target-specific override before
execution. The first `upgrade.js` process waits for the create issue to execute, so run
the required admins' create votes in separate shells using identical frozen source,
then finish the set-logic votes.

```sh
node deploy/upgrade.js --proxy-address "$VALIDATOR_REGISTRY_PROXY" \
  --contract-name ValidatorRegistryMigration \
  --contract-file Staking/ValidatorRegistryMigration.sol +OVERRIDE-CHECKS
node deploy/upgrade.js --proxy-address "$STAKING_PROXY" \
  --contract-name StratoStakingMigration \
  --contract-file Staking/StratoStakingMigration.sol +OVERRIDE-CHECKS
node deploy/staking-setup.js migraterecords reviewed-plan.json
node deploy/staking-setup.js migrateprofiles reviewed-plan.json
```

Finish each proxy swap before the next step. The target calls are:

```text
StratoStakingMigration.migrateRecords(
  operatorKeys: reviewed-plan.operatorKeys,
  validators: reviewed-plan.validators,
  positionCounts: reviewed-plan.positionCounts,
  delegators: reviewed-plan.delegators
)
ValidatorRegistryMigration.migrateProfiles(
  operatorKeys: reviewed-plan.operatorKeys,
  validators: reviewed-plan.validators
)
```

The exact JSON keys are `StratoStakingMigration.migrateRecords` and
`ValidatorRegistryMigration.migrateProfiles`. Both functions require **every** legacy
operator, including inactive records, in operator-list order and execute once. Verify
the 15 records, all position values/checkpoints, profile IDs, totals and pending claims
against the before snapshots. Unbonding queues remain keyed by user and are not moved.

## 3. Wire and bootstrap the 17 current validators

Upgrade governance to the PR logic and vote
`MercataGovernance.setStakingContract(STAKING_PROXY)`. The existing
`gen-governance-source.js` / `deploy-governance.js` and
`staking-setup.js govstaking` cover those calls. Set the temporary staking logic's
registry and USDST pointers if they read zero, and set its governance pointer with
`staking-setup.js govsync off`. Keep sync **off** while listing and bonding: PR #7713's
`selfBond` can otherwise seat a governance validator before the full-set bootstrap.
Vote a positive incumbent `minStake` and set cap of at least 17. The existing
`staking-setup.js setvreg` and `usdst` steps cover the other pointers.
Use explicit Upquark policy values for the remaining votes, rather than the helper's
fixed helium defaults:

```sh
node deploy/staking-setup.js validatorparams "$INCUMBENT_MIN_STAKE_WEI" 0 \
  "$CURRENT_MAX_MISSES" "$CURRENT_JAIL_COOLDOWN"
node deploy/staking-setup.js setparamsvalues 50 50 500 4 \
  "$EXIT_NOTICE_SECONDS" "$UNKICK_COOLDOWN_SECONDS" "$OPERATOR_STAKE_CAP_BPS"
```

The plan lists four governance validators without legacy records. Verify their operator
accounts and metadata, then admin-vote
`ValidatorRegistry.addValidators(validators[4], operators[4], commissions[4],
names[4], descriptions[4], metadataURIs[4], protocolValidatorIds[4])`.
The registry creates their staking records. Before any bond, check the STRATO token's
pause state and the AdminRegistry whitelist for the existing staking proxy. If the
token is paused and either permission is absent, the required admins vote
`node deploy/staking-setup.js whitelisttoken transferFrom` and
`node deploy/staking-setup.js whitelisttoken transfer` as needed. The former permits
staking to pull bonds; the latter permits later unbonding and reward payouts.

Operators must call `STRATO.approve(STAKING_PROXY, amount)` and
`StratoStaking.selfBond(validator, amount)` until all 17 have positive stake at
or above the chosen incumbent minimum. The two mapped zero-weight records also need
funding. If PR #7713's stake delay is enabled, wait until each incumbent's voting
weight is positive before bootstrap. Do not infer operator bindings or mint stake.

Then the required admins vote `node deploy/staking-setup.js bootstrapincumbents`, which calls:

```text
StratoStakingMigration.bootstrapIncumbents()
```

It checks the **entire** governance list before seating anyone, then enables sync and
publishes all weights in the same transaction. Verify 17 seats, the same
17 addresses in governance and `activeValidators`, positive governance weights,
and `seatedUnderSelfBondRule == false` for every incumbent. The two inactive legacy
records must remain unseated.

## 4. Install plain logic, then continue the PR rollout

Admin-vote the plain `ValidatorRegistry.sol` and PR `StratoStaking.sol` implementations
onto their existing proxies with `upgrade.js` / `vote-setlogic.js`. Verify all migrated
stake/rewards/checkpoints and the 17-seat set again. The temporary functions disappear.
Continue at **step 4** of the PR runbook to fund/commit emissions, snapshot weights at
the configured block-2,000,000 staking fork, and open admission afterward. The node
binary upgrade and block-1,000,000 gas fork are separate from these contract calls.
