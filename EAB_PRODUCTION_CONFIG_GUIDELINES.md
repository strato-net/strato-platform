# EAB Production Configuration Guidelines

Use this document to review `deployment.json` before a production rollout. The deployment manifest and live on-chain state are authoritative; this document does not assign token addresses or enable routes.

## 1. Supported inventory

The production network registry currently supports:

- Ethereum (`1`)
- Base (`8453`)
- Linea (`59144`)
- Robinhood Chain (`4663`)
- HyperEVM (`999`)

The currently documented bridged asset inventory includes:

- Native asset: ETH
- Bitcoin: WBTC
- Liquid staking tokens: wstETH and rETH
- Stablecoins: USDC and USDT
- Metals: PAXG and XAUt

Native STRATO routes are configured separately and may include USDST, GOLDST, SILVST, STRATO and saveUSDST.

This inventory is informational. For every rollout, discover routes from live contracts and verify:

- external chain ID;
- external token address, or the zero address for the native asset;
- STRATO token address and active status;
- external token name, symbol and decimals;
- intended route type;
- custody contract;
- oracle and rebase requirements.

Never approve a route from its symbol alone. Addresses and decimals are chain-specific.

## 2. Configuration ownership

The actors are:

- Product and risk owners approve supported routes and economic limits.
- Coordinator records the approved values in `deployment.json`.
- Infra supplies RPC, verifier, Runtime, KMS and health configuration.
- STRATO admins approve STRATO bridge configuration.
- Safe owners approve external vault and router configuration.

Production STRATO Coordinator/admin accounts must retain their required OTP policy. Set a fresh `OAUTH_TOTP` in `app/contracts/.env` immediately before each STRATO-authenticated command; the scripts authenticate once and reuse the resulting token for that command. Clear or replace the consumed code afterward.

The expected flow is:

1. Discover current contracts and routes.
2. Review chain evidence and token metadata.
3. Approve limits in human units.
4. Convert every limit to integer base units.
5. Record values in `deployment.json`.
6. Run `prepare` and review the generated summary.
7. Apply configuration while intake is paused.
8. Start services and verify effective configuration.
9. Activate only the approved routes.
10. Run canaries and reconcile custody and supply.

Configuration errors fail closed. A missing route, unsupported RPC capability, threshold mismatch, stale signer set, exceeded limit or unavailable finality must stop automatic settlement.

## 3. Chain configuration

### Verifiers and quorum

Production networks require:

- five distinct settlement verifiers;
- a three-signature threshold;
- five distinct external authorization signers;
- independent verifier credentials and KMS keys;
- proposer, executor and verifier identities that are all distinct;
- Safe owners that are not Runtime proposer or executor identities.

STRATO settlement verifier accounts and external vault authorization signers are separate identity sets with separate credentials and responsibilities. In addition:

- STRATO relayer and bridge operator accounts must not be enabled settlement verifiers;
- the external bridge executor must not be a vault authorization signer;
- each verifier URL must be HTTPS and have its own API token;
- configured verifier URLs, API tokens, authorization signers and expected verifier count must agree.

Do not reduce quorum for a faster rollout. Testnet uses three verifiers with a two-signature threshold, but testnet values are not production defaults.

### RPC requirements

For each enabled chain:

- configure Runtime with `CHAIN_<ID>_RPC_URL` plus `CHAIN_<ID>_VERIFICATION_RPC_URLS`;
- configure each verifier with `VERIFIER_RPC_URL` plus `VERIFIER_INDEPENDENT_RPC_URLS`;
- provide at least two independent HTTPS verification RPC hosts in each process;
- use different providers or independently operated infrastructure;
- verify `eth_chainId`;
- verify `eth_getBlockByNumber("finalized")` returns a numbered block and hash;
- verify both RPCs agree on canonical blocks at the requested heights;
- require `trace_transaction` or supported `debug_traceTransaction` call tracing when native-asset deposits are enabled; ERC-20-only chains do not require the trace probe;
- verify archive or historical reads cover the configured starting block;
- measure rate limits and worst-case response latency under backlog load.

Do not accept an endpoint merely because it recognizes the `finalized` tag. Confirm that the tag represents the chain's documented finality guarantee, including any L1 dependency.

### Finality and confirmation floor

Deposit settlement requires both:

- the receipt has at least `services.confirmations` newer blocks; and
- the receipt block is at or below the lowest agreed finalized head.

These checks run concurrently. Confirmations are a minimum observation floor, not an additional wait after finalization.

Set:

- `services.confirmations` to the approved per-chain block floor;
- each `services.verifiers[].confirmations` to the same value or higher.

Regenerate and redeploy the service archive after changing these manifest values. Runtime reads the generated `CHAIN_<ID>_DEPOSIT_CONFIRMATIONS`; each verifier reads the generated `VERIFIER_CONFIRMATIONS`.

Choose the floor from measured chain block time and the minimum desired observation period:

```text
confirmation floor = ceil(minimum observation seconds / measured block seconds)
```

Record the measurement date, RPC providers, observed block time and finalized-head lag with the approval. On chains where finality is slower, finality controls settlement time. Do not lower the confirmation floor to bypass a slow finalized head.

`services.deploymentConfirmations` is separate. The deployment wrapper maps it to the chain-scoped deployment variable. It controls external contract deployment receipt depth, not bridge deposit settlement.

### Starting block

Set `lastProcessedBlock` to the reviewed `ExternalAssetDepositRouter` deployment block for a fresh rollout. Verify the block hash through independent RPCs.

Do not use:

- zero as a convenience;
- the current head;
- a block copied from another chain;
- an earlier router deployment;
- an unverified explorer value.

Starting too early creates unnecessary scanning. Starting too late can permanently miss deposits.

### Authorization validity

`maxAuthorizationValiditySeconds` must be positive and cannot exceed 1,800 seconds.

Choose a value that permits normal signing and execution while limiting stale authorization exposure. Manual Safe operations must complete before the deadline or be regenerated.

The STRATO `ExternalAssetBridge.MAX_AUTHORIZATION_VALIDITY_SECONDS` and external vault `maxAuthorizationValiditySeconds` must be identical. Verifiers reject a mismatch. The current rollout assumes the STRATO value already matches the reviewed vault value; use the default 1,800 seconds unless a separate STRATO governance change is included and verified.

Also review `EXTERNAL_BRIDGE_MANUAL_REVIEW_VALIDITY_SECONDS`, which defaults to seven days. It controls how long a large-withdrawal Safe review remains usable and is separate from the maximum authorization validity.

## 4. Token and route configuration

All amounts are unsigned integer base units. Convert an approved human amount using the external token's verified decimals:

```text
raw amount = human amount × 10^decimals
```

Store the result as a decimal string. Never use JavaScript floating-point arithmetic for this conversion.

The units differ by field:

- `minDepositAmount` and `maxAutoDepositAmount` use external-token base units.
- `maxPerWithdrawal`, `manualReviewThreshold`, `maxAutoWithdrawalAmount`, withdrawal `bucketCapacity` and withdrawal `refillRate` use external-token base units.
- STRATO mint `capacity` and mint `refillRate` use destination STRATO-token base units.

Apply the route's decimal and rebase conversion before comparing external automatic limits with STRATO mint capacity.

### `minDepositAmount`

This is the minimum amount accepted by the external deposit router for an external token.

Set it high enough to reject:

- dust;
- deposits whose operational cost exceeds their value;
- amounts that become zero or economically meaningless after decimal conversion or rebase handling.

A route with `rebaseRequired=true` must have a positive minimum.

The value must fit the router's `uint96` storage limit: `0 <= minDepositAmount <= 2^96 - 1`.

### `maxAutoDepositAmount`

This is the verifier's maximum automatic approval amount for one external-token-to-STRATO-token route.

- At or below the value: the verifier may approve automatically.
- Above the value: the deposit requires manual review.
- Zero means every positive deposit requires manual review; it does not disable the route.

Set this below the maximum loss acceptable from one automatically settled deposit. Its converted STRATO amount must be no higher than the usable STRATO mint capacity. Tooling does not enforce this cross-unit comparison; reviewers must calculate and record it.

### STRATO mint `capacity`

This is the maximum burst mint consumption for one STRATO token. It is shared by every external chain and route minting that same STRATO token.

Account for aggregate exposure. Adding another USDC route, for example, does not create an independent STRATO-side mint budget when both routes mint the same token.

Set capacity no higher than:

- the approved incident exposure for that STRATO token;
- verifiable aggregate external custody;
- the amount that operations can reconcile and contain before refill restores capacity.

### STRATO mint `refillRate`

This is the amount of consumed mint capacity restored per second.

Use:

```text
refill rate = approved replenishment amount / replenishment seconds
full refill time = ceil(capacity / refill rate)
```

Both capacity and refill rate must be positive, and refill rate cannot exceed capacity.

### `maxPerWithdrawal`

This is the hard per-withdrawal limit enforced on STRATO and by the external vault.

- A nonzero value rejects larger withdrawals.
- Zero disables the per-withdrawal cap.

Production configurations should use zero only after explicit approval. The value cannot exceed `bucketCapacity`.

### `bucketCapacity`

This is the maximum burst withdrawal capacity for one external token in one external vault.

It must be positive. Set it no higher than:

- the approved chain-and-token incident exposure;
- usable vault liquidity after reserves;
- the amount operations can replenish or pause before unacceptable depletion.

Outstanding reservations also consume availability. A configured capacity does not override insufficient vault liquidity.

### Withdrawal `refillRate`

This restores consumed external withdrawal capacity per second.

Set it from the approved rolling outflow budget:

```text
refill rate = approved rolling outflow / rolling period seconds
```

It must be positive and cannot exceed `bucketCapacity`.

### `manualReviewThreshold`

Withdrawals above this value require the external vault's large-withdrawal approval.

- Zero disables this additional on-chain review.
- A nonzero threshold should not exceed the hard and bucket limits.

Use zero in production only after explicit approval.

### `maxAutoWithdrawalAmount`

This is the verifier's maximum automatic approval amount for one withdrawal.

- Above the value: the withdrawal requires manual review.
- Zero sends every positive withdrawal to manual review.

It must not exceed a nonzero `maxPerWithdrawal` or a nonzero `manualReviewThreshold`.

### Route switches

Review independently:

- `depositsEnabled`;
- `withdrawalsEnabled`;
- `autoRouteEnabled`;
- `rebaseRequired`;
- vault token `enabled`.

Do not infer one switch from another. A token can be held in custody while a route is disabled, and automatic routing can be disabled while direct delivery remains valid.

Initial rollout tooling keeps withdrawals, automatic actions and liquidity migration disabled. Enable them only through the separate post-canary procedure.

### `rebaseRequired`

Set this only from the actual STRATO representation and oracle conversion behavior. Do not infer it from a token being yield-bearing.

Verify a real deposit amount against:

- external transfer evidence;
- external decimals;
- STRATO token decimals;
- oracle rebase factor;
- permitted rounding and truncation.

### `migrateAmount`

Keep this at zero for an initial rollout.

Any nonzero migration requires:

- reconciled legacy custody;
- destination vault balance checks;
- a separately reviewed transfer;
- before-and-after custody evidence;
- rollback and incident ownership.

## 5. Existing asset classes

Use the following review emphasis for the existing inventory.

### ETH

- External token is the zero address.
- Verify native transfer traces on every verifier RPC.
- Reserve gas separately from transferable wallet balances.
- Review vault native liquidity and chain gas volatility.

### WBTC

- Verify token address and decimals independently on every chain.
- Set limits from BTC-denominated custody and a stress-high USD price.
- Do not reuse 18-decimal values.

### wstETH and rETH

- Verify whether the configured STRATO representation uses a rebase factor.
- Test amount conversion and rounding with a real deposit.
- Review oracle freshness and liquidity independently from ETH.

### USDC and USDT

- Verify the canonical issuer contract on each chain.
- Verify decimals; do not assume every stablecoin representation is identical.
- Size limits for depeg, issuer freeze and cross-chain concentration risk.
- Aggregate routes that mint the same STRATO token into one mint-capacity budget.

### PAXG and XAUt

- Verify issuer contract, decimals and transfer behavior.
- Review issuer controls, market liquidity and oracle trading hours.
- Do not copy limits between gold tokens solely because they track the same commodity.

### Native STRATO assets

- Confirm custody-vault capacity before enabling a route.
- Confirm representation token ownership, mint authority and transfer endpoints.
- Keep native mint and redemption budgets separate from EAB token limits.
- Reconcile locked STRATO custody against external representation supply.

## 6. Proposed Phase 1 production baseline

The following values are the recommended starting proposal for a controlled production launch. They are not existing approved limits and are not applied automatically by the rollout tooling. Product, risk and operations owners must approve them before they are copied into `deployment.json`.

This baseline uses:

- a minimum deposit near $10;
- a maximum automatic single deposit near $10,000;
- a shared mint burst near $100,000 per STRATO destination token;
- a hard single-withdrawal maximum near $25,000;
- automatic processing and manual-review thresholds near $5,000;
- a withdrawal burst near $100,000;
- refill over approximately 24 hours;
- no initial liquidity migration;
- withdrawals and automatic actions disabled until post-canary activation.

The token quantities below intentionally use conservative stress-high prices rather than spot prices. If the resulting USD value is materially higher at approval time, lower the token quantity; do not raise the USD exposure without a separate approval.

### Chain values

Use five verifiers with threshold three on every production chain.

Set Runtime `services.confirmations` and every verifier's `confirmations` to:

- Ethereum (`1`): `12`
- Base (`8453`): `60`
- Linea (`59144`): `120`
- Robinhood Chain (`4663`): `12000`
- HyperEVM (`999`): `120`, only after the selected production RPCs pass finalized-head and historical-read probes

These are observation floors. Settlement must still wait for the agreed finalized head, so Linea or another chain with slow finality may take hours even after the numeric floor is met.

Use `12` for `services.deploymentConfirmations`. Contracts must remain paused and unused until their deployment receipts are finalized and independently verified; this deployment value is not a substitute for that check.

Set:

- `maxAuthorizationValiditySeconds`: `1800`
- `EXTERNAL_BRIDGE_MANUAL_REVIEW_VALIDITY_SECONDS`: `604800`
- native `maxAttestationValiditySeconds`: `604800`

The native value matches the existing seven-day mainnet runbook. An expired native withdrawal is not automatically re-attested; it enters the cancellation and refund path.

### EAB stablecoins: USDC and USDT

For a verified six-decimal external token:

```text
minDepositAmount             = 10000000          # 10 tokens
maxAutoDepositAmount         = 10000000000       # 10,000 tokens
maxPerWithdrawal             = 25000000000       # 25,000 tokens
manualReviewThreshold        = 5000000000        # 5,000 tokens
maxAutoWithdrawalAmount      = 5000000000        # 5,000 tokens
withdrawal bucketCapacity    = 100000000000      # 100,000 tokens
withdrawal refillRate        = 1157407            # base units/second; at least 24 hours
```

For the 18-decimal STRATO destination token:

```text
mint capacity                = 100000000000000000000000
mint refillRate              = 1157407407407407407
```

Each mint capacity is shared across every external route that mints that same STRATO token.

### EAB ETH, wstETH and rETH

For an 18-decimal external token or native asset:

```text
minDepositAmount             = 10000000000000000      # 0.01 token
maxAutoDepositAmount         = 2000000000000000000    # 2 tokens
maxPerWithdrawal             = 5000000000000000000    # 5 tokens
manualReviewThreshold        = 1000000000000000000    # 1 token
maxAutoWithdrawalAmount      = 1000000000000000000    # 1 token
withdrawal bucketCapacity    = 20000000000000000000   # 20 tokens
withdrawal refillRate        = 231481481481481         # base units/second; at least 24 hours
```

For the 18-decimal STRATO destination token:

```text
mint capacity                = 20000000000000000000
mint refillRate              = 231481481481481
```

Apply the values independently to ETH, wstETH and rETH only after checking each route's stressed price, conversion and usable custody.

### EAB WBTC

For a verified eight-decimal external token:

```text
minDepositAmount             = 10000       # 0.0001 WBTC
maxAutoDepositAmount         = 10000000    # 0.1 WBTC
maxPerWithdrawal             = 10000000    # 0.1 WBTC
manualReviewThreshold        = 2000000     # 0.02 WBTC
maxAutoWithdrawalAmount      = 2000000     # 0.02 WBTC
withdrawal bucketCapacity    = 50000000    # 0.5 WBTC
withdrawal refillRate        = 578         # base units/second; at least 24 hours
```

For the 18-decimal STRATO destination token:

```text
mint capacity                = 500000000000000000
mint refillRate              = 5787037037037
```

### EAB PAXG and XAUt

Use the following human limits for each gold token:

```text
minimum deposit              = 0.01 token
maximum automatic deposit    = 1 token
maximum single withdrawal    = 2 tokens
manual-review threshold      = 0.5 token
maximum automatic withdrawal = 0.5 token
withdrawal bucket            = 10 tokens
STRATO mint capacity         = 10 tokens
full refill period           = at least 24 hours
```

Convert these amounts with the live contract's verified decimals. For an 18-decimal PAXG route, the bucket is `10000000000000000000` and its refill rate is `115740740740740`. For a six-decimal XAUt route, the bucket is `10000000` and its refill rate is `115`. The STRATO mint capacity remains 18-decimal.

### Native STRATO routes

Use the following human limits:

```text
USDST:
  maxPerWithdrawal           = 25,000 USDST
  instantWithdrawalThreshold = 5,000 USDST
  maxOutstandingWithdrawal   = 100,000 USDST

GOLDST:
  maxPerWithdrawal           = 5 GOLDST
  instantWithdrawalThreshold = 1 GOLDST
  maxOutstandingWithdrawal   = 20 GOLDST

SILVST:
  maxPerWithdrawal           = 400 SILVST
  instantWithdrawalThreshold = 80 SILVST
  maxOutstandingWithdrawal   = 1,600 SILVST
```

For 18-decimal USDST, the raw values are:

```text
maxPerWithdrawal             = 25000000000000000000000
instantWithdrawalThreshold   = 5000000000000000000000
maxOutstandingWithdrawal     = 100000000000000000000000
```

If the live contracts confirm 18 decimals, the GOLDST raw values are:

```text
maxPerWithdrawal             = 5000000000000000000
instantWithdrawalThreshold   = 1000000000000000000
maxOutstandingWithdrawal     = 20000000000000000000
```

The corresponding SILVST raw values are:

```text
maxPerWithdrawal             = 400000000000000000000
instantWithdrawalThreshold   = 80000000000000000000
maxOutstandingWithdrawal     = 1600000000000000000000
```

For `saveUSDST`, use the same $25,000 / $5,000 / $100,000 limits expressed in shares at the current on-chain share-to-asset conversion. Round down and record the conversion block.

For STRATO, calculate token quantities using a separately approved stress-high price:

```text
maxPerWithdrawal             = floor($25,000 / approved stress price)
instantWithdrawalThreshold   = floor($5,000 / approved stress price)
maxOutstandingWithdrawal     = floor($100,000 / approved stress price)
```

Do not hardcode a STRATO token count without that price approval. `maxOutstandingWithdrawal` is shared by all external routes for the same STRATO token; it is not a separate allowance per external chain.

### Approval rules for exceptions

Lower any proposed value when custody, liquidity, oracle, issuer, RPC or operational evidence supports a smaller limit. Raising one requires explicit approval of the resulting automatic incident exposure and aggregate cross-chain exposure.

Do not derive route enablement from these numbers. The manifest still explicitly controls supported tokens, native-asset support, deposits, withdrawals, automatic routing and migration.

## 7. Setting production limit exceptions

For every chain-token pair, record:

- approved maximum single automatic deposit;
- approved STRATO-token aggregate mint burst;
- approved mint replenishment period;
- approved maximum single withdrawal;
- approved automatic-withdrawal maximum;
- manual-review threshold;
- approved withdrawal burst;
- approved rolling outflow and period;
- minimum economically meaningful deposit;
- current vault liquidity;
- stressed token price used for approval;
- incident owner and pause authority.

Use a stress-high token price when converting a fixed USD loss ceiling into token units. Use actual token liquidity, custody concentration and operational response time as independent caps.

The final configured value should be the minimum produced by the applicable constraints, not the largest value accepted by any one constraint.

For a six-decimal token, an approved human amount of `10,000` is:

```text
10,000 × 10^6 = 10,000,000,000
```

For an 18-decimal token, the same human amount is:

```text
10,000 × 10^18 = 10,000,000,000,000,000,000,000
```

These examples demonstrate conversion only; they are not approved production limits.

## 8. Cross-chain review

Before approving an additional chain:

1. Group routes by STRATO destination token.
2. Convert and sum automatic deposit exposure across chains in destination-token units.
3. Compare it with the shared STRATO mint capacity.
4. Group withdrawals by external chain and custody vault.
5. Compare bucket capacity with usable vault liquidity.
6. Verify manual-review staffing and Safe availability.
7. Confirm pause authority is reachable without Runtime.
8. Confirm finality and RPC behavior under provider failure.

Do not review each route in isolation. Correlated provider, issuer, oracle or chain failures can affect several routes simultaneously.

## 9. Production approval record

The approval record should include:

```json
{
  "chainId": "<EXTERNAL_CHAIN_ID>",
  "evidenceDate": "<UTC_TIMESTAMP>",
  "rpcProviders": ["<PROVIDER_A>", "<PROVIDER_B>"],
  "confirmations": "<POSITIVE_BLOCK_COUNT>",
  "observedBlockSeconds": "<MEASURED_VALUE>",
  "observedFinalizedLag": "<P50_AND_P95>",
  "safe": "<SAFE_ADDRESS>",
  "verifierCount": 5,
  "verifierThreshold": 3,
  "routes": [{
    "externalToken": "<ADDRESS_OR_ZERO>",
    "stratoToken": "<ADDRESS>",
    "externalDecimals": "<VERIFIED_DECIMALS>",
    "limitsApproval": "<TICKET_OR_RECORD>",
    "custodyEvidence": "<REFERENCE>",
    "oracleEvidence": "<REFERENCE>"
  }]
}
```

Do not place credentials, API tokens, private keys or authenticated RPC URLs in this record.

## 10. Final checks

Before configuration:

- no `REVIEW_REQUIRED` values remain;
- every address and decimal value was independently verified;
- every amount was converted from an approved human value;
- shared mint exposure was reviewed across all chains;
- every automatic deposit limit was converted and checked against remaining mint capacity;
- vault capacity was checked against liquidity;
- Runtime and verifier confirmation floors match;
- finalized-head and trace support passed on independent RPCs;
- STRATO and vault authorization-validity values match;
- manual-review validity was explicitly reviewed;
- Safe owners, threshold, roles and pause authority match;
- migration amount is zero unless separately approved.

Before activation:

- Runtime and every verifier report the reviewed effective configuration;
- contracts remain paused while configuration is incomplete;
- STRATO and external configuration match;
- deposit, withdrawal and automatic-action switches match the approval;
- canary amounts are below every applicable automatic limit;
- custody and supply reconciliation starts from recorded balances.

After activation:

- reconcile each canary from external custody through STRATO supply and recipient balance;
- verify no duplicate settlement or release;
- verify above-limit requests take the intended review path;
- verify pause and recovery procedures;
- record effective on-chain values rather than relying only on the manifest.
