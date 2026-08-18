# Production Deployment: GOLDST and SILVST Yield Vaults

Run this only after the Helium testnet deployment and acceptance trace in
`metal_yield_vault_deployment_testnet.md` have passed.

- Deposits remain in their original GOLDST or SILVST denomination.
- Do not initialize funded accrual.
- Do not approve a strategy or deploy capital.
- Reward Points come only from `Rewards` Position activities.

## Upquark Details

- Network: Upquark mainnet
- Network ID: `33056204878082667`
- GOLDST: `cdc93d30182125e05eec985b631c7c61b3f63ff0`
- SILVST: `2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94`
- PriceOracle: `0000000000000000000000000000000000001002`
- AdminRegistry/owner: `000000000000000000000000000000000000100c`
- Rewards: `4a116cf8cb056036632aef08f7c0df27c720f1c0`
- Existing ETH YieldVault proxy: `a94905d8bd117e9bfbe57aadffd7abbea760e028`
- GOLDST YieldVault proxy: `<created during deployment>`
- SILVST YieldVault proxy: `<created during deployment>`
- YieldVault implementation: `<verified before deployment>`
- GOLDST Rewards activity ID: `<created during deployment>`
- SILVST Rewards activity ID: `<created during deployment>`

Verify every tracked address against the live production node before submitting a
transaction.

## Setup

Use the approved production release commit:

```bash
git fetch origin
git checkout develop
git pull --ff-only origin develop
git status --porcelain
```

The final command must produce no output.

Ensure `app/contracts/.env` contains:

```bash
GLOBAL_ADMIN_NAME=<admin username>
GLOBAL_ADMIN_PASSWORD=<admin password>
OAUTH_CLIENT_ID=<OAuth client ID>
OAUTH_CLIENT_SECRET=<OAuth client secret>
OAUTH_URL=<OAuth discovery URL>
NODE_URL=<production STRATO node URL>
OAUTH_TOTP=<current authenticator code>
```

`OAUTH_TOTP` is required only when MFA is enabled. Update it immediately before
running a deployment command.

Define deployment values outside source control:

```bash
export ADMIN_REGISTRY=000000000000000000000000000000000000100c
export GOLDST=cdc93d30182125e05eec985b631c7c61b3f63ff0
export SILVST=2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94
export REWARDS=4a116cf8cb056036632aef08f7c0df27c720f1c0
export YIELD_VAULT_IMPLEMENTATION=<verified production implementation address>
export GOLDST_SEED_WEI=<approved non-trivial production GOLDST seed>
export SILVST_SEED_WEI=<approved non-trivial production SILVST seed>
export GOLDST_EMISSION_RATE=<approved production CATA wei per second>
export SILVST_EMISSION_RATE=<approved production CATA wei per second>
```

Do not put credentials, private keys, access tokens, or TOTP values in the repository.

## 1. Production Preflight

Confirm the testnet evidence has been reviewed and accepted. In production SMD, verify:

1. The connected network ID is `33056204878082667`.
2. GOLDST and SILVST are active and both report `18` decimals.
3. `PriceOracle.getAssetPriceWithTimestamp(token)` returns a non-zero, current value
   for both tokens.
4. `Proxy(a94905d8bd117e9bfbe57aadffd7abbea760e028).logicContract` is the approved
   production `YieldVault` implementation.
5. The implementation contains the current queue and opt-in accrual code.
6. The new proxy owner will be
   `000000000000000000000000000000000000100c`.
7. Production seed amounts and Rewards emission rates have explicit approval.

Set `YIELD_VAULT_IMPLEMENTATION` to the verified implementation. Stop if it cannot
be tied to the approved release.

If the referenced ETH YieldVault upgrade has not executed, complete that approved
upgrade first and use its `New Implementation` address. Do not deploy from an
unreviewed local implementation.

## 2. Deploy the Proxies

From `app/contracts`, deploy GOLDST:

```bash
npm run deployProxy -- \
  --impl "$YIELD_VAULT_IMPLEMENTATION" \
  --owner "$ADMIN_REGISTRY" \
  --contract-file BaseCodeCollection.sol
```

Record the address:

```bash
export GOLDST_YIELD_VAULT=<created GOLDST proxy>
```

Run the same command again for SILVST and record:

```bash
export SILVST_YIELD_VAULT=<created SILVST proxy>
```

Complete any resulting governance votes. Verify both proxies:

- addresses are different
- `logicContract = $YIELD_VAULT_IMPLEMENTATION`
- owner is `000000000000000000000000000000000000100c`

## 3. Initialize the Vaults

From `app/contracts`:

```bash
node deploy/archive/initialize-vault.js \
  --vault-address "$GOLDST_YIELD_VAULT" \
  --asset "$GOLDST" \
  --name "GOLDST Yield Vault" \
  --symbol "yieldGOLDST"
```

```bash
node deploy/archive/initialize-vault.js \
  --vault-address "$SILVST_YIELD_VAULT" \
  --asset "$SILVST" \
  --name "SILVST Yield Vault" \
  --symbol "yieldSILVST"
```

Complete each governance vote. Verify each vault:

- `vaultInitialized = true`
- `asset()` is the expected metal token
- name and symbol match the command
- `decimals() = 18`
- owner is `000000000000000000000000000000000000100c`
- `minIdleBps = 0`
- `deployedAssets = 0`
- `totalClaimableAssets = 0`
- `accrualInitialized = false`
- `perSecondSavingsRate = 0`
- `rewardDistributor = 0000000000000000000000000000000000000000`
- `accrualBaseAssets = 0`

Do not call `initializeAccrual`, `setRewardDistributor`,
`setPerSecondSavingsRate`, `setStrategyApproval`, or `deployCapital`.

## 4. Seed the Empty Vaults

Seed both vaults before publishing their addresses. The production seed wallet must
retain the resulting shares.

For GOLDST, call as the seed wallet:

```text
Contract: cdc93d30182125e05eec985b631c7c61b3f63ff0
Method: approve(address,uint256)
spender: $GOLDST_YIELD_VAULT
value:   $GOLDST_SEED_WEI
```

Then:

```text
Contract: $GOLDST_YIELD_VAULT
Method: deposit(uint256,address)
assets:   $GOLDST_SEED_WEI
receiver: <production seed wallet>
```

Repeat with the SILVST token, `$SILVST_YIELD_VAULT`, and
`$SILVST_SEED_WEI`.

Verify after each seed:

- seed-wallet underlying decreased by the deposit amount
- vault idle balance increased by the deposit amount
- seed-wallet shares increased by the deposit amount
- `totalSupply` equals seeded shares
- `deployedAssets = 0`
- `exchangeRate() = 1000000000000000000`

Do not transfer or redeem seed shares while the vault is active.

## 5. Register Disabled Rewards Activities

Create both production Position activities with emission `0`.

GOLDST:

```text
Contract: 4a116cf8cb056036632aef08f7c0df27c720f1c0
Method: addPositionActivity(string,uint256,address,ActionableEvent[])
name:           GOLDST Yield Vault
emissionRate:   0
sourceContract: $GOLDST_YIELD_VAULT
actionableEvents:
  [
    {"eventName":"Deposit","actionType":"Deposit"},
    {"eventName":"Withdraw","actionType":"Withdraw"},
    {"eventName":"QueueProcessed","actionType":"Withdraw"}
  ]
```

SILVST:

```text
Contract: 4a116cf8cb056036632aef08f7c0df27c720f1c0
Method: addPositionActivity(string,uint256,address,ActionableEvent[])
name:           SILVST Yield Vault
emissionRate:   0
sourceContract: $SILVST_YIELD_VAULT
actionableEvents:
  [
    {"eventName":"Deposit","actionType":"Deposit"},
    {"eventName":"Withdraw","actionType":"Withdraw"},
    {"eventName":"QueueProcessed","actionType":"Withdraw"}
  ]
```

Complete both votes. Record the activity IDs and verify the source contracts,
all three source-event mappings, Position type, and zero emission.

## 6. Configure the Production Rewards Poller

Add both lower-case proxy addresses, without `0x`, to
`app/services/rewards-poller/src/infra/config/attributeMapping.json`:

```json
"<goldst production proxy>": {
  "Deposit": { "amount": "shares", "user": "owner" },
  "Withdraw": { "amount": "shares", "user": "owner" },
  "QueueProcessed": { "amount": "sharesBurned", "user": "owner" }
},
"<silvst production proxy>": {
  "Deposit": { "amount": "shares", "user": "owner" },
  "Withdraw": { "amount": "shares", "user": "owner" },
  "QueueProcessed": { "amount": "sharesBurned", "user": "owner" }
}
```

Build and test the poller release. Deploy it before enabling either production
emission rate.

## 7. Configure the Production App

Add the verified proxy addresses to `app/backend/src/config/config.ts`. The expected
network map is:

```text
defaultGoldstYieldVaultFor:
  114784819836269: <verified GOLDST testnet proxy>
  33056204878082667: <GOLDST production proxy>

defaultSilvstYieldVaultFor:
  114784819836269: <verified SILVST testnet proxy>
  33056204878082667: <SILVST production proxy>
```

Do not use environment-only address overrides for the release. Both network entries
must contain their respective verified proxy addresses in backend configuration.

Build and stage the backend and UI release. Before enabling emissions, verify:

- `/earn/yield-vault` lists both production addresses
- each `/info` endpoint reports the correct metal and seeded TVL
- `accrualInitialized` is `false`
- `deployedAssets` and strategy holdings are zero
- USD TVL uses the correct metal oracle price
- both Earn cards open the correct vault page
- no funded Base APY is displayed

Do not expose the release to users yet.

## 8. Enable Production Reward Points

Set the approved rates last:

```text
Contract: 4a116cf8cb056036632aef08f7c0df27c720f1c0
Method: setEmissionRate(uint256,uint256)
activityId:      <GOLDST activity ID>
newEmissionRate: $GOLDST_EMISSION_RATE
```

```text
Contract: 4a116cf8cb056036632aef08f7c0df27c720f1c0
Method: setEmissionRate(uint256,uint256)
activityId:      <SILVST activity ID>
newEmissionRate: $SILVST_EMISSION_RATE
```

Complete both votes. Verify both activities show the approved non-zero rates.

## 9. Release the Production App

Release the poller, backend, and UI versions containing the verified production
addresses. Confirm service health before enabling user traffic.

## 10. Production Verification

Use separate minimal user deposits for GOLDST and SILVST.

```text
Entry:
  user underlying balance
  user share balance
  vault idleAssets
  vault deployedAssets
  Rewards user stake

Deposit:
  approve underlying
  deposit underlying
  observe YieldVault.Deposit

Exit:
  underlying decreases by assets
  shares increase by shares
  idleAssets increases by assets
  deployedAssets remains 0
  Rewards stake increases after poller processing
  accrualInitialized remains false
```

Redeem the test shares and verify:

- redemption is immediate
- assets return to the user
- Rewards stake decreases after poller processing
- `deployedAssets` remains `0`
- `accrualInitialized` remains `false`
- no distributor-funded `Accrued` event is emitted

Record transaction hashes, governance issue IDs, proxy addresses, activity IDs, API
responses, and Rewards stake changes.

## Production Rollback

If Reward Points are incorrect:

1. Set both activity emission rates to `0`.
2. Keep the vaults available so users can redeem.
3. Remove production app configuration if UI deposits must stop.
4. Fix and redeploy the poller before restoring emission.

Pause only for a contract-level incident because pause also blocks normal redemption.
