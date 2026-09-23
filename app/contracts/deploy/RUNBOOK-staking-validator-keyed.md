# Helium: upgrade staking to the validator-keyed contracts in place

Upgrades the helium StratoStaking proxy (`d6726e06…9b81`) and ValidatorRegistry proxy
(`bfbb75bb…08dd`) to the validator-keyed `StratoStaking.sol` / `ValidatorRegistry.sol`, routes
block rewards through staking, and moves to the self-bond minimum — without changing the
consensus set or its weights at any step.

"Vote" = an AdminRegistry issue; run the command once per admin (two votes execute). All commands
run from `app/contracts/deploy` with the usual `.env` (`NODE_URL`, OAuth client,
`GLOBAL_ADMIN_NAME` / `GLOBAL_ADMIN_PASSWORD`).

## Why the logic swap is consensus-neutral

- Storage is keyed by name and the contracts keep their historical names. Helium listed every
  validator as its own operator, so the four live records are already keyed by validator address
  and carry over as they are (a record without an `operator` field is operated by its key).
- `selfBondGraceUntil` has never been written, so it reads 0 and the old rule
  (self-bond + delegated ≥ minStake) still applies: all four stay eligible.
- `_syncValidator`, governance calls and `ValidatorSynced` / `ValidatorStakeUpdated` emission are
  unchanged; proposer-fee attribution resolves the same record for each proposer.
- The only behavioural change at block level is where the 0.01 STRATO block reward goes, and only
  once the new router is installed. That is ordinary deterministic contract state.

## 0. Before: record the state

```sh
curl -s "$NODE_URL/bloc/v2.2/contracts/StratoStaking/d6726e06c3c71a3bad80b5eb6925707a31729b81/state" > staking-before.json
curl -s "$NODE_URL/bloc/v2.2/contracts/MercataGovernance/0000000000000000000000000000000000000100/state" > governance-before.json
```

Check: `validatorCount` 4, `isValidator` true for `0c4c…`, `bdd3…`, `ebcd…`, `f1e4…`; governance
`validators` and `validatorStake` match `lastSyncedWeight`; no `selfBondGraceUntil`.

## 1. Swap the logic: registry, then staking, back to back

The two contracts call hooks only each other's current logic has. Between the swaps, listing and
delisting fail; staking itself (stake, fees, liveness) is unaffected.

```sh
node deploy-staking.js gen registry
node deploy-staking.js gen staking
```

For each target (`registry` first, then `staking`):

1. Admin A: `node deploy-staking.js deploy <target>` (first create vote).
2. Admin B: `node deploy-staking.js deploy <target>` (create executes, prints the logic address,
   casts the first `setLogicContract` vote).
3. Admin A: `node vote-setlogic.js <proxy> <logic address>` (second vote executes the swap).

Do not re-run `deploy` for the second vote: it would open another create issue.

A one-off data fix can ride along as a temporary logic: `gen staking --splice <functions.sol> --out
staking-surgery-source.txt`, deploy it with `--source staking-surgery-source.txt`, run the fix,
then swap back to the plain `staking` logic.

## 2. Verify continuity

- `creditBlockReward` and `indexValidatorSet` appear in the staking contract's bloc function list.
- `validatorCount` 4; `isValidator`, `lastSyncedWeight`, `jailedUntil`, `delegatedStake`,
  `totalUserStake`, `totalRewardableStake` identical to step 0.
- Governance state identical to step 0 (no `ValidatorAdded` / `ValidatorRemoved` / stake events).
- The chain keeps committing and all four keep proposing.

## 3. Index the existing consensus set (direct, permissionless)

```sh
node staking-setup.js index
```

`activeValidatorCount()` → 4. Until this runs, set-wide passes (eviction, resyncs) see no members,
which fails safe.

## 4. Delist the zero-stake test record (vote, required)

Every listed record is a potential validator: the record key *is* the consensus address.
`deadbeef00000000000000000000000000001235` is an active test record, and helium's `joinsPaused` was
never written (joins are open), so anyone could delegate `minStake` to it and `tryActivate` a
validator no node runs. Delist it with a `removeValidator` vote on the registry.

## 5. Give each validator a human operator (votes)

```sh
node staking-setup.js setoperator <validator> <operator account>   # per validator, both admins
```

The outgoing operator (the node address) is paid its accrued STRATO rewards and USDST fees; it has
no self-bond to release. Membership and weights do not change.

## 6. Self-bond, then end the grace period

1. Each validator's operator holds at least `minStake` (10,000 STRATO) of self-bond, via
   `selfBond(validator, amount)` or the staking page. (Helium 2026-09: blockapps_test_1's own
   delegations were converted to its self-bond with a temporary surgery logic instead.)
2. Confirm `operators[v].selfBond ≥ minStake` for all four.
3. Vote the deadline: `node staking-setup.js grace <unix seconds>`. A deadline in the past applies
   the self-bond rule at once; with every validator bonded, nobody leaves the set.

## 7. Route block rewards through staking

```sh
node gen-feerouter-source.js d6726e06c3c71a3bad80b5eb6925707a31729b81 HeliumFeeRouterV2
FEE_ROUTER_NAME=HeliumFeeRouterV2 node deploy-feerouter.js      # both admins
FEE_ROUTER=<new router> node staking-setup.js fundrouter          # vote: mint 10,000 STRATO to it
node install-feerouter.js install <new router>                    # DeciderState owner, single tx
```

No whitelist vote is needed: the router only `approve`s (not pause-gated) and staking already holds
the STRATO `transferFrom` whitelist entry. Verify: `BlockRewardsPaid` events from the new router,
`BlockRewardCredited` events from staking, `totalRewardsCredited` rising. Rollback:
`node install-feerouter.js install 44769a27b4339f1dbdab8920be9b5689b6652178`. The old router has no
withdrawal function, so its remaining STRATO stays where it is.

## 8. Deploy the backend and UI

The backend detects the validator-keyed contract from the staking contract's bloc function list.

## Optional cleanup

- `whitelist-staking.js` once whitelisted the staking proxy for `voteToAddValidator` /
  `voteToRemoveValidator` on 0x100; nothing calls those, so the entries can be revoked.
