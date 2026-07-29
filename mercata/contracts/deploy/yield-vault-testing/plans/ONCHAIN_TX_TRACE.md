# YieldVault command-sheet on-chain transaction trace

This is the transaction order for the populated testnet configuration in `.env`
and the current run-state. Amounts are raw 18-decimal integers.

## Addresses and constants

- `ADMIN_REGISTRY` = `000000000000000000000000000000000000100c`
- `ASSET` = `470c0ed4ab7cf2dafc363d136e01d5e839d4f891`
- `FEE_TOKEN` = `937efa7e3a77e20bbdbd7c0d32b6514f368c1010`
- `VAULT_PROXY` = fresh address created by DEPLOYER after artifact cleanup
- `OLD_IMPLEMENTATION` = fresh address created by DEPLOYER after artifact cleanup
- `NEW_IMPLEMENTATION` = address created by the safe-upgrade deployment transaction
- `MINTER` = `1b7dc206ef2fe3aab27404b88c36470ccf16c0ce`
- `DEPLOYER` = `MINTER` (`Admin #1`), used only for `createContract`
- `OWNER` = `7b1f8cd02cd09ab9510e30fc8e15ff898a639771`
- `ALICE` = `e4f080a6d6e442a8f256cb76b51f3ea4c49659e0`
- `BOB` = `e1fbd5f906a2a40d7c5349248efc6054c3168715`
- `CAROL` = `529171ea8c2f83284144a2d5ff445a0cd1606e90`
- `STRATEGY` = `20d097e86b27e271056dfc7a2cd3c91e5f38e80e`
- `LOSS_SINK` = `000000000000000000000000000000000000100d`
- `SMOKE_USER` = `87fb479d1bcbfa84e14bcd8ee5e81ff794433dab`
- `REWARD_DISTRIBUTOR` = `a16cf0a258ec1a8739282fd290c5633a109e10fe`
- `DONOR` = `b126e58eac4059666896d3c6cd1cf57d68d15c7c`
- `DAVE` = `7c9858c390a28fa01f0e81817fc002cc8f14d956`
- `U` = `1000000000000000000`
- `RAY` = `1000000000000000000000000000`
- `MAX_RATE` = `1000000021979553151239153027`
- `MAX_UINT256` = `115792089237316195423570985008687907853269984665640564039457584007913129639935`
- Live AdminRegistry admins:
  - `MINTER`
  - `OWNER`
  - `7051b38506804716eb5d1f2bf783a281140223a3`
- `APPROVER` = any live admin other than the admin that submitted the target call

For each governed pair below:

1. the first transaction is the exact target call and creates/casts the first
   vote on an AdminRegistry issue; and
2. the second transaction is the automated APPROVER call to that exact same
   target function with the exact same arguments. Ownable fallback binds it to
   the deterministic issue and executes the target call.

No flow calls `AdminRegistry.castVoteOnIssue`. Rerunning a checkpoint after
approval only verifies the saved execution and does not send a third transaction.

Live state was checked on 2026-07-28: there are three admins, the default
threshold is `6000` bps, and the voting-threshold override table has no rows.
Each issue therefore needs `ceil(3 * 6000 / 10000) - 1 = 1` additional approval
transaction. If governance membership or thresholds change, recheck this before
using the transaction count below.

## Abandoned historical Phase 0

Proxy `917e95e65bf009dd17610d3b68052c05d91ffb7b` and implementation
`f4c539b8f15fa2ea059ad8457b8d882e5bf3ee35` were created by
`Admin #2`, are not Cirrus-indexed for this workflow, and are abandoned.
Do not delete them, do not resume their run-state, and never approve issue
`cfb8808c4c13a7dea92b41fe673b7763db45a9c96dc10bdfd6a2883291c460d9`.

The first DEPLOYER retry created proxy
`992b80a357a8791be149bab77b67de39eb96293e` and old implementation
`22cba31ff2dec15e6ed0c1e84190e872408535b3`, but the implementation did
not appear in Cirrus because the request omitted `query.username=BlockApps`.
Those contracts and issue
`3fb3989392fd44b77e53085968a8500156e21dd686880a7adfef87cfca2c723d`
are also abandoned and must not be approved.

## Fresh Step 0 after artifact cleanup

Use `yield-vault-old-proxy-run-state-cirrus-v2.json` and
`yield-vault-old-proxy-evidence-cirrus-v2.json`. DEPLOYER submissions include
the canonical `query.username=BlockApps` indexing option. The expected
sequence is:

1. `DEPLOYER -> DEPLOYER_USER.createContract("Proxy", reviewedCombinedSource, deadbeef, ADMIN_REGISTRY)`
   - `APPROVER -> DEPLOYER_USER.createContract(...)` with identical nested args
2. `DEPLOYER -> DEPLOYER_USER.createContract("YieldVault", reviewedYieldVaultOldCombinedSource, deadbeef)`
   - `APPROVER -> DEPLOYER_USER.createContract(...)` with identical nested args
3. `OWNER -> VAULT_PROXY.setLogicContract(OLD_IMPLEMENTATION)`
   - `APPROVER -> VAULT_PROXY.setLogicContract(OLD_IMPLEMENTATION)`

The scripts journal and submit each second call automatically. Resume identical
artifact paths after interruption; no checkpoint may submit either call twice.

Fresh Step 0 completed with:

- Proxy: `f55ea6d9e708dd326a5f9faeb49e07e4609696d3`
- YieldVaultOld: `a36c2124057aded1da21c363ac8ee3ec5300d9f9`
- Proxy create issue: `0439be6e088f51463a7f4087c5d4b8d3798ef4fc5cf9ec8e783bd385618ca9a5`
- YieldVaultOld create issue: `646e8f197091859cf52f30a192ef86777d52d706a47ffd4412e5d5a3ddb2abcf`
- Pointer activation issue: `b2aec7ceabccd6d1e02372fd83bef11097f1a000400165e1f196bca21eda62c5`

All three issues are approved and the evidence artifact is complete.

## Step 1: tests and actor-file generation

No on-chain transactions. `npm test` uses local test doubles, and
`yield-vault:actors` only writes JSON.

## Step 2: fund actors

Each numbered item is one governed pair in the displayed order.

### Fee-token mints

1. `MINTER -> FEE_TOKEN.mint(MINTER, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(MINTER, 2000000000000000000)`
2. `MINTER -> FEE_TOKEN.mint(OWNER, 10000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(OWNER, 10000000000000000000)`
3. `MINTER -> FEE_TOKEN.mint(ALICE, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(ALICE, 2000000000000000000)`
4. `MINTER -> FEE_TOKEN.mint(BOB, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(BOB, 2000000000000000000)`
5. `MINTER -> FEE_TOKEN.mint(CAROL, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(CAROL, 2000000000000000000)`
6. `MINTER -> FEE_TOKEN.mint(STRATEGY, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(STRATEGY, 2000000000000000000)`
7. `MINTER -> FEE_TOKEN.mint(SMOKE_USER, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(SMOKE_USER, 2000000000000000000)`
8. `MINTER -> FEE_TOKEN.mint(REWARD_DISTRIBUTOR, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(REWARD_DISTRIBUTOR, 2000000000000000000)`
9. `MINTER -> FEE_TOKEN.mint(DONOR, 2000000000000000000)`
   - `APPROVER -> FEE_TOKEN.mint(DONOR, 2000000000000000000)`
10. `MINTER -> FEE_TOKEN.mint(DAVE, 2000000000000000000)`
    - `APPROVER -> FEE_TOKEN.mint(DAVE, 2000000000000000000)`

### Underlying-asset mints for `--runs 10`

1. `MINTER -> ASSET.mint(ALICE, 2000000000000000000000)`
   - `APPROVER -> ASSET.mint(ALICE, 2000000000000000000000)`
2. `MINTER -> ASSET.mint(BOB, 1500000000000000000000)`
   - `APPROVER -> ASSET.mint(BOB, 1500000000000000000000)`
3. `MINTER -> ASSET.mint(CAROL, 1000000000000000000000)`
   - `APPROVER -> ASSET.mint(CAROL, 1000000000000000000000)`
4. `MINTER -> ASSET.mint(STRATEGY, 300000000000000000000)`
   - `APPROVER -> ASSET.mint(STRATEGY, 300000000000000000000)`
5. `MINTER -> ASSET.mint(SMOKE_USER, 100000000000000000000)`
   - `APPROVER -> ASSET.mint(SMOKE_USER, 100000000000000000000)`
6. `MINTER -> ASSET.mint(REWARD_DISTRIBUTOR, 300000000000000000000)`
   - `APPROVER -> ASSET.mint(REWARD_DISTRIBUTOR, 300000000000000000000)`
7. `MINTER -> ASSET.mint(DONOR, 50000000000000000000)`
   - `APPROVER -> ASSET.mint(DONOR, 50000000000000000000)`
8. `MINTER -> ASSET.mint(DAVE, 250000000000000000000)`
   - `APPROVER -> ASSET.mint(DAVE, 250000000000000000000)`

## Step 3: old fixture deployment

Use the fresh Step 0 sequence above. The historical proxy, implementation, and
pending issue are not inputs to this workflow.

## Step 4: seed `YieldVaultOld`

### Initialize and deposits

1. `OWNER -> VAULT_PROXY.initialize(ASSET, "Testnet Legacy Yield Vault", "tLEGACY-YV")`
   - `APPROVER -> VAULT_PROXY.initialize(ASSET, "Testnet Legacy Yield Vault", "tLEGACY-YV")`
2. `ALICE -> ASSET.approve(VAULT_PROXY, MAX_UINT256)`
3. `ALICE -> VAULT_PROXY.deposit(200000000000000000000, ALICE)`
4. `BOB -> ASSET.approve(VAULT_PROXY, MAX_UINT256)`
5. `BOB -> VAULT_PROXY.deposit(150000000000000000000, BOB)`
6. `CAROL -> ASSET.approve(VAULT_PROXY, MAX_UINT256)`
7. `CAROL -> VAULT_PROXY.deposit(100000000000000000000, CAROL)`

### Configure and exercise strategy accounting

1. `OWNER -> VAULT_PROXY.setMinIdleBps(1000)`
   - `APPROVER -> VAULT_PROXY.setMinIdleBps(1000)`
2. `OWNER -> VAULT_PROXY.setStrategyApproval(STRATEGY, true)`
   - `APPROVER -> VAULT_PROXY.setStrategyApproval(STRATEGY, true)`
3. `OWNER -> VAULT_PROXY.deployCapital(STRATEGY, 300000000000000000000)`
   - `APPROVER -> VAULT_PROXY.deployCapital(STRATEGY, 300000000000000000000)`
4. `STRATEGY -> ASSET.approve(VAULT_PROXY, 320000000000000000000)`
5. `OWNER -> VAULT_PROXY.returnCapital(STRATEGY, 320000000000000000000)`
   - `APPROVER -> VAULT_PROXY.returnCapital(STRATEGY, 320000000000000000000)`
6. `OWNER -> VAULT_PROXY.deployCapital(STRATEGY, 220000000000000000000)`
   - `APPROVER -> VAULT_PROXY.deployCapital(STRATEGY, 220000000000000000000)`
7. `STRATEGY -> ASSET.transfer(LOSS_SINK, 20000000000000000000)`
8. `OWNER -> VAULT_PROXY.reportStrategyLoss(STRATEGY, 20000000000000000000)`
   - `APPROVER -> VAULT_PROXY.reportStrategyLoss(STRATEGY, 20000000000000000000)`

### Build and partially process the legacy queue

1. `ALICE -> VAULT_PROXY.requestRedeem(120000000000000000000, ALICE, ALICE)`
2. `BOB -> VAULT_PROXY.requestRedeem(80000000000000000000, BOB, BOB)`
3. `OWNER -> VAULT_PROXY.processQueue(1, 50000000000000000000)`
   - `APPROVER -> VAULT_PROXY.processQueue(1, 50000000000000000000)`

## Step 5: initial snapshot

No on-chain transactions; all operations are authenticated reads.

## Step 6: safe upgrade and smoke sequence

### Pause, deploy, and switch implementation

1. `OWNER -> VAULT_PROXY.pause()`
   - `APPROVER -> VAULT_PROXY.pause()`
2. `DEPLOYER -> ADMIN_REGISTRY.createContract("YieldVault", reviewedCombinedSource, deadbeef)`
   - `APPROVER -> DEPLOYER_USER.createContract(...)` with identical nested args
   - the execution output address becomes `NEW_IMPLEMENTATION`
3. `OWNER -> VAULT_PROXY.setLogicContract(NEW_IMPLEMENTATION)`
   - `APPROVER -> VAULT_PROXY.setLogicContract(NEW_IMPLEMENTATION)`

### Initialize appended accrual storage

1. `OWNER -> VAULT_PROXY.initializeAccrual()`
   - `APPROVER -> VAULT_PROXY.initializeAccrual()`
   - execution succeeds
2. `OWNER -> VAULT_PROXY.initializeAccrual()`
   - creates the same deterministic issue ID again after the first issue is cleared
   - `APPROVER -> VAULT_PROXY.initializeAccrual()`
   - execution transaction intentionally fails with `accrual already initialized`

The post-initialization snapshot sends no transaction.

### Configure reward funding while paused

1. `OWNER -> VAULT_PROXY.setRewardDistributor(REWARD_DISTRIBUTOR)`
   - `APPROVER -> VAULT_PROXY.setRewardDistributor(REWARD_DISTRIBUTOR)`
2. `OWNER -> VAULT_PROXY.setPerSecondSavingsRate(1000000000000000000000000000)`
   - `APPROVER -> VAULT_PROXY.setPerSecondSavingsRate(1000000000000000000000000000)`
3. `REWARD_DISTRIBUTOR -> ASSET.approve(VAULT_PROXY, 30000000000000000000)`
4. `SMOKE_USER -> ASSET.approve(VAULT_PROXY, 10000000000000000000)`

Steps 1-2 remain manual; steps 3-4 are submitted by
`yield-vault:prepare-smoke`.

The pre-smoke snapshot sends no transaction.

### Unpause and smoke

1. `OWNER -> VAULT_PROXY.unpause()`
   - `APPROVER -> VAULT_PROXY.unpause()`
2. `SMOKE_USER -> VAULT_PROXY.deposit(10000000000000000000, SMOKE_USER)`
3. `SMOKE_USER -> VAULT_PROXY.redeemOrQueue(10000000000000000000, SMOKE_USER, SMOKE_USER)`
4. `OWNER -> VAULT_PROXY.processQueue(3, 160000000000000000000)`
   - `APPROVER -> VAULT_PROXY.processQueue(3, 160000000000000000000)`
5. `SMOKE_USER -> VAULT_PROXY.claim(SMOKE_USER)`

## Step 7: validated runbook report

No on-chain transactions. Copying evidence and generating the report only read
receipts, events, live state, and local artifacts.

## Step 8: post-upgrade E2E

### Preserved claims and expected negative calls

1. `ALICE -> VAULT_PROXY.claim(ALICE)`
2. `BOB -> VAULT_PROXY.claim(BOB)`
3. `ALICE -> VAULT_PROXY.claim(ALICE)` — intentionally failed transaction:
   `nothing claimable`
4. `BOB -> VAULT_PROXY.claim(BOB)` — intentionally failed transaction:
   `nothing claimable`

### Strategy profit, loss, and return

1. `STRATEGY -> ASSET.approve(VAULT_PROXY, MAX_UINT256)`
2. `OWNER -> VAULT_PROXY.returnCapital(STRATEGY, 210000000000000000000)`
   - `APPROVER -> VAULT_PROXY.returnCapital(STRATEGY, 210000000000000000000)`
3. `OWNER -> VAULT_PROXY.deployCapital(STRATEGY, 80000000000000000000)`
   - `APPROVER -> VAULT_PROXY.deployCapital(STRATEGY, 80000000000000000000)`
4. `STRATEGY -> ASSET.transfer(LOSS_SINK, 20000000000000000000)`
5. `OWNER -> VAULT_PROXY.reportStrategyLoss(STRATEGY, 20000000000000000000)`
   - `APPROVER -> VAULT_PROXY.reportStrategyLoss(STRATEGY, 20000000000000000000)`
6. `OWNER -> VAULT_PROXY.returnCapital(STRATEGY, 60000000000000000000)`
   - `APPROVER -> VAULT_PROXY.returnCapital(STRATEGY, 60000000000000000000)`

### Instant redemption and funded accrual

1. `CAROL -> VAULT_PROXY.redeem(25000000000000000000, CAROL, CAROL)`
2. `OWNER -> VAULT_PROXY.setPerSecondSavingsRate(1000000021979553151239153027)`
   - `APPROVER -> VAULT_PROXY.setPerSecondSavingsRate(1000000021979553151239153027)`
3. After the script observes a block timestamp at least `lastAccrual + 60`:
   `OWNER -> VAULT_PROXY.accrue()`
   - `APPROVER -> VAULT_PROXY.accrue()`
4. `OWNER -> VAULT_PROXY.setPerSecondSavingsRate(1000000000000000000000000000)`
   - `APPROVER -> VAULT_PROXY.setPerSecondSavingsRate(1000000000000000000000000000)`

Let `Y` be the total assets actually credited by the `accrue()` execution and
the rate-restoration execution. `Y` is execution-timestamp-dependent and is not
knowable before those blocks are mined.

### Donation reconciliation and DAVE round trip

1. `DONOR -> ASSET.transfer(VAULT_PROXY, 5000000000000000000)`
2. `DAVE -> ASSET.approve(VAULT_PROXY, MAX_UINT256)`
3. `DAVE -> VAULT_PROXY.deposit(25000000000000000000, DAVE)`
4. `DAVE -> VAULT_PROXY.redeem(DAVE_SHARES, DAVE, DAVE)`

The exact runtime argument is:

`DAVE_SHARES = floor(25000000000000000000 * 225000000000000000000 / (216000000000000000000 + Y))`

### New queue lifecycle

Let:

- `DAVE_ASSETS = floor(DAVE_SHARES * (241000000000000000000 + Y) / (225000000000000000000 + DAVE_SHARES))`
- `QUEUE_START_ASSETS = 241000000000000000000 + Y - DAVE_ASSETS`
- `DEPLOY_AMOUNT = QUEUE_START_ASSETS - ceil(QUEUE_START_ASSETS / 10)`

Transactions:

1. `OWNER -> VAULT_PROXY.deployCapital(STRATEGY, DEPLOY_AMOUNT)`
   - `APPROVER -> VAULT_PROXY.deployCapital(STRATEGY, DEPLOY_AMOUNT)`
2. `ALICE -> VAULT_PROXY.redeemOrQueue(80000000000000000000, ALICE, ALICE)`
3. `OWNER -> VAULT_PROXY.processQueue(1, 10000000000000000000)`
   - `APPROVER -> VAULT_PROXY.processQueue(1, 10000000000000000000)`
4. `ALICE -> VAULT_PROXY.claim(ALICE)`
5. `STRATEGY -> ASSET.approve(VAULT_PROXY, MAX_UINT256)`
6. `OWNER -> VAULT_PROXY.returnCapital(STRATEGY, DEPLOY_AMOUNT)`
   - `APPROVER -> VAULT_PROXY.returnCapital(STRATEGY, DEPLOY_AMOUNT)`
7. `OWNER -> VAULT_PROXY.processQueue(1, MAX_UINT256)`
   - `APPROVER -> VAULT_PROXY.processQueue(1, MAX_UINT256)`
8. `ALICE -> VAULT_PROXY.claim(ALICE)`

The final E2E reconciliation checkpoint sends no transaction.

## Transaction count

The former 122-transaction count is invalid because it assumed the abandoned
Phase 0 artifacts and a direct OWNER deployment. Recalculate from the fresh
DEPLOYER creation issues and current live governance threshold after cleanup.
The repeated `initializeAccrual()` and repeated ALICE/BOB claim executions
remain intentional failures.
