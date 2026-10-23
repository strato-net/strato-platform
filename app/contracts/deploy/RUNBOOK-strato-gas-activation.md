# STRATO as gas: qualification gates and activation

Step 6 of the migration plan: prove the complete flow on helium, then activate on
upquark at one agreed block. Each gate below says how it is checked, what helium
shows today, and what is still owed. `node strato-gas-audit.js` re-derives every
chain-data gate from a node's Cirrus and RPC, read-only; a run is the evidence.

All commands run from `app/contracts/deploy` with the usual `.env` (`NODE_URL`, OAuth
client, `GLOBAL_ADMIN_NAME` / `GLOBAL_ADMIN_PASSWORD`).

## The helium pilot (live since 2026-10-19)

| Piece | Where |
|---|---|
| STRATO token, burnable logic, unpaused | proxy `8ee9a339…8b04`, impl `646cdf8e…cb04` |
| Canonical STRATO/USDST PoolV3 (fee 3000, cardinality 500) | `6df32c9b…3165` |
| HeliumFeeRouterV4 (voucher, else burn STRATO, USDST buys a shortfall) | `76a6839f…9da9d6`, installed at block 803253 |
| Native-token flag day (eth_getBalance, native transfers, envelope rules) | helium block 900000 (`stratoGasForkBlock`) |
| App (fee quote, send-max, voucher display) | deploy_testnet_app_ha #25, strato-gas 0750d10 |

Status line: `node strato-gas-helium.js status 76a6839f96b8265a0edcbfc141f7cc89b09da9d6`.
Full audit: `node strato-gas-audit.js --nodes https://node1.testnet.strato.nexus,…,https://node5.testnet.strato.nexus`.

## Gates

Legend: **contract** = `app/contracts/tests/Staking/FeeRouter.test.sol` (39 cases,
`solid-vm-cli test`); **node** = `strato/core/vm-tools/test/StratoGasEnvelopeSpec.hs`;
**audit** = `strato-gas-audit.js` gate name; **live** = a procedure to run on the network.

### 1. Exact balance and supply reconciliation

| Check | How | Helium 2026-10-22 |
|---|---|---|
| Every fee equals the block's quote (or one whole voucher) | audit *fees charged at the block quote* | 30,058 fees, 0 mismatches |
| Every burned fee left the supply; nothing else burned | audit *burned fees reconcile with supply* | 155.88 STRATO in 14,109 txs, 0 differ, other burns 0 |
| totalSupply equals the sum of balances | same gate | 47,680,847 = sum of 30 balances |
| Reverted transactions still pay | audit *every included transaction paid* | 6 reverted in 300 blocks, all paid, 0 unpaid |
| Receipts show the fee log wallets read | audit *receipts carry the FeePaid log* | **FAIL on helium**: 12 of 341 receipts lack it. The runner dropped the fee hook's delegatecall record whenever the transaction had its own action, so Cirrus never recorded the router's code at those payers and the receipt builder could not resolve FeePaid (the charge itself was right). Fixed in `vm-runner` `attachFeeResult` on this branch; after redeploy each payer's next transaction repairs its whole history, since the record is per (payer, contract name) |

### 2. Voucher, balance and batch cases

| Case | How | Helium |
|---|---|---|
| Whole voucher preferred over STRATO | contract `it_prefers_a_whole_voucher_over_strato`; audit method counts | 15,949 voucher-paid calls |
| Fractional voucher falls through to STRATO | contract `it_burns_strato_when_the_voucher_is_fractional` | no fractional holder on helium yet; live: mint 1.5 vouchers to a test key, send 2 calls, expect VOUCHER then STRATO_BURN |
| Insufficient balance rejected before inclusion | contract `it_reverts_when_the_signer_cannot_pay`, `it_reverts_when_the_shortfall_cannot_be_bought`; node admission rejects a failing payFees | live: fresh key with nothing, expect the Bloc error, no block includes it |
| USDST-only account keeps transacting | contract `it_buys_the_whole_fee_when_the_signer_holds_no_strato`, `it_refuses_to_overpay_for_the_shortfall`; audit *USDST-only accounts* | 9 payers, 126 calls via USDST_SWAP_BURN |
| Many calls from one payer in one block | audit *multi-transaction blocks* | 3,539 payer-blocks with >1 fee, max 20 |

### 3. Oracle

The router prices once per block from the pool's 30-minute TWAP (`_twapWindow` 1800 s),
keeps the last price for 60 minutes if the pool stops pricing (`_priceGrace` 3600 s),
and then charges vouchers only until pricing returns.

| Case | How | Helium / owed |
|---|---|---|
| Same-block manipulation | contract `it_charges_the_time_weighted_price_not_the_spot`, `it_freezes_one_fee_per_block`; audit *quote moves like a time-weighted price* | largest block-to-block move 0% over 24,918 quotes; quote within 0.01% of spot |
| Sustained manipulation | **not covered by a test.** Moving the 30-minute average by x% means holding spot moved by about x% for 30 minutes against the pool's depth. Live: swap enough USDST to move spot 10%, hold 35 minutes, confirm the quote moves at most ~10% and recovers after the swap back | PASS helium 2026-10-23: 4,900 USDST in at block 836440 (14:55Z) moved spot +10.0% (tick -997 to -43); the quote fell linearly from 0.011048 to 0.010043 STRATO (-9.09%, the full fee-side value of the move) and only reached it 30 min later; largest block step 0.45%. 5,160 STRATO back at 15:32Z put spot on tick -997 and the quote was back to 0.011048339 exactly by 16:02Z. 35 min of held spot bought nothing beyond the 10% paid to move the pool |
| Liquidity removal | contract `it_ignores_a_pool_below_the_liquidity_floor`, `it_does_not_price_until_the_pool_has_a_full_window_of_history`, `it_keeps_the_last_price_through_the_grace_period` | **`_minPoolLiquidity` is 0 on helium, so nothing stops pricing**: `liquidity() >= 0` holds for an empty pool, and the observation ring keeps serving the last tick. Verified live 2026-10-23: with the pool fully drained (liquidity 0, blocks 836925-837010) the router still wrote a quote every block, frozen at the last price, `valid` stayed true. Upquark must ship a floor > 0 from mainnet depth |
| Oracle recovery | contract `it_keeps_the_last_price_through_the_grace_period`; the quote resumes the first block the pool prices again (`_quoteStratoFee`) | **not reachable live on helium**: without a liquidity floor an empty pool never stops pricing (see above), so the grace path only runs in the contract tests. To run it live, deploy a router with a floor (upquark, or a helium V5) and drain the pool below it; expect ≥60 min in which only vouchers pay |

### 4. Wallet

| Case | How | Status |
|---|---|---|
| Fee display "0.0110 STRATO · 0.01 USDST equivalent" / "Covered by N vouchers" | `app/ui/src/utils/feeUtils.ts` `describeFee`, `NetworkFee` | live on app.testnet |
| Send-max reserves the fee (STRATO first, USDST for the rest) | `computeMaxTransferable` | live |
| Voucher-only use | vouchers cover calls before any token is touched | live |
| Stale signed quote | node `rejects a quote above the signed bound and asks for a requote`; wallets must sign maxFeePerGas × 21000 ≥ the block quote | live after helium block 900000: sign with a fee below the quote, expect FeeBoundExceeded |

### 5. Proposer and verifier agree

| Case | How | Helium |
|---|---|---|
| Identical results across validators | audit *nodes agree* | 5 of 5 at the same height, one hash (node5 still on the pre-step-4 build, so mixed builds agree before the fork) |
| Quote and reward exactly once per block, in the same block | contract `it_pays_block_rewards_at_most_once_per_block`, `it_prices_and_rewards_in_the_same_block`; audit *one STRATO quote per block*, *one block reward per block* | 24,918 of each over 24,918 blocks |
| Replay from genesis across the router install | **owed**: `strato-up --network=helium` from genesis (or a snapshot older than 803253) on the release build must reach the tip with the validators' hash. The Jenkins Deploy stage does not sync to tip, so it is not evidence |

### 6. Activation rules stay reproducible

| Case | How | Status |
|---|---|---|
| Legacy envelopes only before the fork; type-2 required for native value after | node `accepts only legacy envelopes before the fork`, `requires a type-2 envelope for native-value transfers from the fork` | helium flag day 900000 not reached (~2026-10-31) |
| Replay across the fork | same replay as gate 5, run after 900000 | owed |
| Historical meaning preserved | `nativeTokenAt` keys on height, `ethconf.yaml` keeps USDST as the pre-fork token | by construction |

## Activation on upquark, at one block A

Preconditions, in order. "Vote" = one AdminRegistry issue, run once per admin.

1. **Pick A and ship the node.** Set `stratoGasForkBlock "upquark"` in
   `strato/core/strato-conf/src/Blockchain/EthConf/Model.hs` (today the unscheduled
   sentinel), release, and upgrade every validator and the app before A. Mixed builds
   agree until A; at A a validator on the old build forks off.
2. **Token.** Upgrade the STRATO proxy to the burnable logic (`upgrade.js`, vote) and
   either unpause it (vote) or whitelist the router (`whitelist-feerouter.js`, vote).
3. **Pool.** Create the canonical STRATO/USDST PoolV3 (vote), seed full-range liquidity,
   grow the observation ring, and let 30 minutes of observations accumulate. Read the
   seeded `liquidity` from `strato-gas-helium.js status` and pick the floor as a fraction
   of it (a tenth keeps ordinary LP churn from stopping pricing; a drained pool must
   fall below it). Below the floor the router stops quoting, the last quote ages out
   after 60 minutes and only vouchers pay until the pool refills.
4. **Router.** `gen-feerouter-source.js upquark --pool <pool> --activate A --min-liquidity <L>`
   (the generator refuses upquark without a floor),
   `deploy-feerouter.js` as both admins, fund it with STRATO for block rewards, and
   decide what tops it up: the router pays 0.01 STRATO per block from its own balance
   and nothing refills it. Before A the router charges the legacy fee (one whole
   voucher, else 0.01 USDST to FeeCollector), writes no quote and pays no reward, so
   `eth_gasPrice`, the fee bound, receipts and the app all keep the legacy fee until A
   on their own. Check the pool prices with `previewStratoFee()` on the router.
5. **Operational balances.** Services and bots: either STRATO, or USDST (the router buys
   their STRATO at up to 2× the call's value) plus `STRATO_TOKEN_ADDRESS` in their env so
   their balance checks count STRATO. Confirm with the audit's payer list.
6. **Switch together at A.** `install-feerouter.js install` days ahead of A. The
   router's activation block and the node's `stratoGasForkBlock` are the same number,
   so fee policy and native currency flip in the same block; contract tests
   `it_charges_the_legacy_usdst_fee_before_activation`, `it_quotes_nothing_and_pays_no_reward_before_activation`
   and `it_switches_to_strato_at_the_activation_block` cover the boundary.
7. **After A.** Run the audit against all validators, re-run the replay gate, and watch
   the router runway and the services' balance checks.

Rollback: `install-feerouter.js rollback` restores DeciderState's own legacy payFees
at any time. The native-token switch at A is consensus and does not roll back; recovery
after A keeps STRATO as gas.

## Open before activation

- Redeploy the runner fix for FeePaid logs in receipts, then re-run the audit (gate 1).
- Oracle-recovery live run needs a router with a liquidity floor (gate 3).
- Replay from genesis on the release build, before and after helium 900000 (gates 5, 6).
- `_minPoolLiquidity` floor for upquark (gate 3): required, an unfloored router quotes a stale price forever once the pool is drained.
- Block-reward funding source (router runway on helium ≈ 21 days on 2026-10-22).
- Upquark values: A, pool seed size, router funding, service funding.
