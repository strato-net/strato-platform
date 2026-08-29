## Bridge

Purpose: Cross-system token bridging into and out of STRATO.

Key contracts:
- `ExternalAssetBridge`: STRATO coordinator for non-native assets.
- `ExternalBridgeVault`: Route-local custody and threshold-authorized releases on each external chain.
- `DepositRouter`: Emits uniquely numbered external deposits and transfers assets to the route vault.
- `TokenRouter`: Executes validated, bounded STRATO routes after bridge settlement.
- `StratoNativeBridge`: Unchanged native-asset bridge.
- `MercataBridge`: Legacy non-native history only while existing activity drains.

Non-native bridge-in:
1. The service detects every router event independently, keyed by `(externalChainId, depositRouter, depositId)`.
2. It waits for the configured confirmations and verifies the canonical receipt, exact router log and vault custody transfer.
3. Plain deposits call `settleDeposit`. `AUTO_ROUTE` deposits receive a fresh backend quote and call `settleDepositWithRoute`; both operations atomically record and complete the deposit while preserving `DepositInitiated` and `DepositCompleted`. ExternalAssetBridge converts the verified raw external amount to STRATO decimals and applies any required inbound rebase factor on-chain.
4. Save and Forge remain user-facing destinations, but both are TokenRouter routes encoded as `AUTO_ROUTE = 4`. Legacy action ordinals 2 and 3 are not executed by ExternalAssetBridge.
5. Before external submission the UI states the exact STRATO source token and amount the recipient will receive if routing fails. If route quoting or execution cannot satisfy the signed `minFinalOut`, the recipient receives that source token through `DepositActionFallback`; custody is never left unsettled.
6. RPC conflicts, permanently missing receipts and expired settlement retries enter persistent review/quarantine.
7. Reviewed deposits are re-verified and resolved through `confirmReviewedDepositWithRoute` (or source-token fallback), or owner-governed `abortDeposit`.

`externalTxHash` is metadata, not replay identity. Multiple deposits in one external transaction settle and report action outcomes independently.

Activity history enriches the canonical completion with `AutoRouted` or `DepositActionFallback` final-token data and labels it `Deposit & Trade` or `Deposit (Fallback)`. Rewards continue to consume only `DepositCompleted` and its bridged source amount; action outcomes are presentation metadata and do not create a second reward.

External action intent is not cryptographically signed by the external wallet. The bridge operator is trusted to submit the verified deposit identity, STRATO recipient, source route and action intent observed in the DepositRouter event. The absolute `minFinalOut` is preserved from that event, refreshed route-step minima are derived from it, and every submitted authority choice is logged. Contract route allowlists, on-chain rebase accounting, replay protection and source-token fallback bound the operator's effect, but a compromised operator remains able to choose settlement parameters within those controls.

Non-native bridge-out:
1. `requestWithdrawal` escrows the STRATO token.
2. Routine withdrawals receive short-lived authorization from independent KMS/HSM signers.
3. The unprivileged executor reserves and releases route-local vault liquidity.
4. STRATO finalization burns escrow only after the external release is verified.
5. Large withdrawals additionally require Safe review. Expired reservations can be cancelled and refunded through governance.

Operational controls:
- Deposit and withdrawal pause controls are independent.
- Safe/AdminRegistry owns governance; the bridge operator performs routine settlement and finalization.
- Production requires explicit positive confirmation counts, independent signer RPCs, and authenticated webhook and review-operation endpoints.
- Router rotation preserves prior router identities. A governance-aborted deposit ID remains final until owner governance separately calls `authorizeDepositReuse`.
- Configure the bridge PriceOracle and mark the route rebase-required before enabling xStock. The flag is canonical for inbound division and outbound multiplication; required routes reject zero/missing factors.
- The service never mutates the observed external amount for rebasing. Missing factors fail only the affected settlement or review-record attempt; the remaining chain batch continues.
- TokenRouter-originated Forge and vault events are excluded from user activity and rewards attribution. The canonical ExternalAssetBridge completion attributes the deposit to its recipient without double counting.
- DepositRouter 3.2 or newer is required for native ETH `AUTO_ROUTE`.

Deployment order:
1. Deploy `TokenRouter` implementation and proxy separately, initialize it with the V2/V3 factories, PSM, MetalForge and SaveUSDSTVault, approve allowed yield vaults, then transfer proxy ownership to AdminRegistry.
2. Call `ExternalAssetBridge.setTokenRouter(proxy)` through governance.
3. Upgrade each external `DepositRouter` to 3.2 and verify `version()`, vault custody, token permissions and route permissions.
4. Enable `ExternalAssetBridge.setDepositAction(externalToken, chainId, stratoToken, 4, true)` only after `/trade/route/quote` succeeds for the intended destinations.
5. Configure backend, bridge service and rewards poller `TOKEN_ROUTER`, plus bridge-service `STRATO_APP_API_URL`. Startup must confirm that the address matches `ExternalAssetBridge.tokenRouter` and that `TokenRouter.initialized` is true.


