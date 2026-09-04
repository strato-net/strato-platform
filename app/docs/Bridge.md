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
2. It waits for the configured confirmations, groups router events by external transaction, and verifies the canonical receipt and traces once. Every event must have one distinct sender/token/custody/amount movement in execution order; exact duplicate RPC evidence is deduplicated, while missing, reused, conflicting, or ambiguous evidence quarantines the entire transaction before any STRATO settlement.
3. Three independent verifier services validate the external event and custody movement against their own RPC providers and record STRATO attestations. After any two attest, any relayer may settle a plain deposit. Routed and reviewed-routed deposits additionally require the bridge operator so an arbitrary relayer cannot select route steps or force source-token fallback. Both operations atomically record and complete the deposit while preserving `DepositInitiated` and `DepositCompleted`. ExternalAssetBridge converts the verified raw external amount to STRATO decimals and applies any required inbound rebase factor on-chain.
4. Save and Forge remain user-facing destinations, but both are TokenRouter routes encoded as `AUTO_ROUTE = 4`. Legacy action ordinals 2 and 3 are not executed by ExternalAssetBridge.
5. Before external submission the UI requires an authenticated STRATO account as recipient, connects the external wallet only as the external-chain signer, switches it to the selected chain, and states the exact STRATO source token and amount the recipient will receive if routing fails. DepositRouter accepts only `AUTO_ROUTE = 4` with a nonzero destination token and positive `minFinalOut`.
6. Deterministic quote or route-execution errors settle through `DepositActionFallback`. Transport errors remain retryable because submission may be ambiguous; RPC conflicts, permanently missing receipts and expired settlement retries enter persistent review/quarantine.
7. Reviewed deposits are re-verified and resolved through `confirmReviewedDepositWithRoute` (or source-token fallback), or owner-governed `abortDeposit`.

`externalTxHash` is metadata, not replay identity. Multiple deposits in one external transaction settle and report action outcomes independently.

Activity history enriches the canonical completion with `AutoRouted` or `DepositActionFallback` final-token data and labels it `Deposit & Trade` or `Deposit (Fallback)`. Direct STRATO routes are recorded from `TokenRouter.RouteExecuted`; Unified Trade displays those recent routes alongside pending and completed bridge deposits. Its STRATO source catalog includes every graph node with an outgoing route, including PSM-only assets, and reserves both STRATO call fees from maximum transferable USDST. Rewards continue to consume only `DepositCompleted` and its bridged source amount; action outcomes are presentation metadata and do not create a second reward.

External action intent is not separately signed by the external wallet; it is emitted by DepositRouter in the externally signed transaction. Each settlement verifier independently binds the deposit identity, STRATO recipient, source route, action, destination token and `minFinalOut` to that canonical event. Route steps are selected by the bridge operator but must execute through TokenRouter's approved dependencies and satisfy the attested destination token and absolute `minFinalOut`. Arbitrary relayers cannot select route steps or force fallback. Contract route allowlists, on-chain rebase accounting, replay protection and source-token fallback remain the execution bounds.

Non-native bridge-out:
1. `requestWithdrawal` escrows the STRATO token.
2. Routine withdrawals receive short-lived authorization from independent KMS/HSM signers.
3. The unprivileged executor reserves and releases route-local vault liquidity.
4. Independent verifier services confirm the exact vault `WithdrawalReleased` event. Any relayer may finalize after two STRATO attestations, and only then is escrow burned.
5. Large withdrawals additionally require Safe review. Expired reservations can be cancelled and refunded through governance.

Operational controls:
- Deposit and withdrawal pause controls are independent.
- Safe/AdminRegistry owns governance. The bridge operator coordinates detection, review and reservation state but cannot mint deposits or finalize withdrawal burns without the 2-of-3 verifier threshold.
- Production requires explicit positive confirmation counts, independent signer RPCs, and authenticated webhook and review-operation endpoints.
- Router rotation preserves prior router identities. A governance-aborted deposit ID remains final until owner governance separately calls `authorizeDepositReuse`.
- Configure the bridge PriceOracle and mark the route rebase-required before enabling xStock. The flag is canonical for inbound division and outbound multiplication; required routes reject zero/missing factors.
- The service never mutates the observed external amount for rebasing. Missing factors fail only the affected settlement or review-record attempt; the remaining chain batch continues.
- TokenRouter-originated Forge and vault events are excluded from user activity and rewards attribution. The canonical ExternalAssetBridge completion attributes the deposit to its recipient without double counting.
- DepositRouter 3.2 or newer is required for native ETH `AUTO_ROUTE`.

Follow-up TODO:
- Deploy three isolated verifier instances per external chain with distinct RPC providers and STRATO identities. Complete production key isolation, scoped credentials, rotation, monitoring and incident-recovery procedures for verifier, executor and governance authorities.

Testnet deployment:

The target networks are Helium (`114784819836269`) and Sepolia (`11155111`). Keep the legacy `MercataBridge` and its DepositRouter unchanged while the new bridge is tested.

Verified Helium addresses:

```text
AdminRegistry     000000000000000000000000000000000000100c
TokenFactory      000000000000000000000000000000000000100b
PoolFactory       000000000000000000000000000000000000100a
PoolV3Factory     e6b6f05a88e649e4102a801aade9a6bae02f352d
DirectMintPSM     0b30adc5f2d90bada37afa699b75f485f04e7287
MetalForge        c5ed981b816a626981a5747d125e0e7296b2c7c6
SaveUSDSTVault    ceeb982f671b4ee2b4471e5b49f3126739537f15
USDST             937efa7e3a77e20bbdbd7c0d32b6514f368c1010
PriceOracle       0000000000000000000000000000000000001002
MercataBridge     0000000000000000000000000000000000001008
USDC YieldVault   9c9bcc6e040910c6705d15864067720923bacc82
GOLDST YieldVault 65ab8049ff949e7ed04838723a07bc9b5a7849e2
SILVST YieldVault 7ecc1ab7e15384cf2392b7dad8878239fda78799
```

Verified Sepolia dependencies:

```text
Permit2                    0x000000000022D473030F116dDEE9F6B43aC78BA3
Legacy DepositRouter       0x1f0457D1d8c3f0dA3e579bE3843DD6E093163B84
Legacy Safe                0x8713850E9fF0fd0200ce87C32E3cdB24eD021631
```

The new STRATO proxies, new Sepolia vault, and new Sepolia DepositRouter do not exist yet; never substitute the legacy DepositRouter for `<NEW_DEPOSIT_ROUTER_PROXY>`.

1. Install, compile, and test:

```bash
cd app/ethereum && npm install && npm run compile && npx hardhat test test/ExternalBridgeVault.js test/DepositRouter.test.js && npm run external:vault:ops:test
```

```bash
cd app/contracts && npm install && npm run test:external-bridge-config
```

```bash
cd app/services/bridge && npm install && npm test
```

2. Deploy the STRATO proxies, owned from inception by AdminRegistry:

```bash
cd app/contracts && node deploy/deployProxy.js --empty --owner 000000000000000000000000000000000000100c
```

Record the first result as `<TOKEN_ROUTER_PROXY>`, then install its implementation:

```bash
cd app/contracts && node deploy/upgrade.js --proxy-address <TOKEN_ROUTER_PROXY> --contract-name TokenRouter --contract-file Router/TokenRouter.sol +OVERRIDE-CHECKS
```

Deploy a second empty proxy and record it as `<EXTERNAL_ASSET_BRIDGE_PROXY>`:

```bash
cd app/contracts && node deploy/deployProxy.js --empty --owner 000000000000000000000000000000000000100c
```

```bash
cd app/contracts && node deploy/upgrade.js --proxy-address <EXTERNAL_ASSET_BRIDGE_PROXY> --contract-name ExternalAssetBridge --contract-file Bridge/ExternalAssetBridge.sol +OVERRIDE-CHECKS
```

Approve each generated AdminRegistry upgrade issue before continuing.

3. Set the `CHAIN_11155111_*` deployment variables from
   `app/ethereum/env.example`, run preflight, then deploy a new Sepolia vault
   and separate DepositRouter 3.2 proxy:

```bash
npm --prefix app/ethereum run deployExternalBridge:sepolia
```

```bash
npm --prefix app/ethereum run deployExternalBridge:sepolia -- --execute
```

The script checks the network and Permit2 bytecode, initializes the router directly against the new vault, verifies version/owner/vault, and writes both proxy and implementation addresses to `app/ethereum/deployments/ExternalBridgeTestnetPair_sepolia_latest.json`.

4. Create the external-vault rollout file:

```bash
cp app/ethereum/externalBridgeVault.config.example.json /secure/path/external-bridge-vault.helium-sepolia.json
```

Set `sourceChainId` to `"114784819836269"`, `sourceBridge` to `<EXTERNAL_ASSET_BRIDGE_PROXY>`, and use the new vault/router proxies from step 3. Configure signer threshold and per-token policy values in raw external units. Keep every `migrateAmount` at `"0"` until smoke tests pass.

5. Generate and review all external Safe operations as JSON:

```bash
npm --prefix app/ethereum run external:vault:ops -- --config /secure/path/external-bridge-vault.helium-sepolia.json --chains 11155111 --step all
```

The audit JSON is written to `app/ethereum/scripts/output/external-bridge-vault-ops-*.json`. Each Safe batch also produces a standalone `external-bridge-vault-*-txbuilder-*.json` file that can be imported into Safe Transaction Builder. Apply only the vault configuration:

```bash
npm --prefix app/ethereum run external:vault:ops -- --config /secure/path/external-bridge-vault.helium-sepolia.json --chains 11155111 --step configure --apply
```

Approve and execute that proposal in Safe. The router step is automatically omitted when the new router already points at the new vault.

6. Copy all currently enabled Sepolia token/route permissions from the canonical legacy mappings into the new router:

```bash
npm --prefix app/ethereum run router:ops:testnet -- --step setters --chains 11155111 --router-address <NEW_DEPOSIT_ROUTER_PROXY> --safe-address <TESTNET_SAFE_ADDRESS>
```

The dry run discovers all enabled mappings from Helium and batches them. It writes an audit file plus one standalone `deposit-router-setters-*-txbuilder-*.json` Safe Transaction Builder import per batch under `app/ethereum/scripts/output`. Confirm that `routerSource` and `safeSource` are both `argument`, and that the target is not the legacy router. Then propose it:

```bash
npm --prefix app/ethereum run router:ops:testnet -- --step setters --chains 11155111 --router-address <NEW_DEPOSIT_ROUTER_PROXY> --safe-address <TESTNET_SAFE_ADDRESS> --apply
```

Approve and execute the proposal, then verify:

```bash
DEPOSIT_ROUTER_ADDRESS=<NEW_DEPOSIT_ROUTER_PROXY> npm --prefix app/ethereum run scan:sepolia
```

7. Copy and complete the Helium governance configuration:

```bash
cp app/contracts/deploy/external-bridge.helium.example.json /secure/path/external-bridge.helium.json
```

Replace the zero deployment/operator/guardian addresses and every `REVIEW_REQUIRED` policy amount. Add any additional reviewed routes as array entries. `maxPerWithdrawal = 0` means uncapped and `manualReviewThreshold = 0` disables manual review, so neither value should be chosen accidentally.

Generate initialization governance JSON:

```bash
npm --prefix app/contracts run configure:external-bridge -- --config /secure/path/external-bridge.helium.json --step initialize
```

Generate chain and multi-token route governance JSON:

```bash
npm --prefix app/contracts run configure:external-bridge -- --config /secure/path/external-bridge.helium.json --step routes
```

Every call is written as an exact `AdminRegistry.castVoteOnIssue` JSON payload under `app/contracts/deploy/deployment-logs/external-bridge-governance-*.json`. After review, each required admin submits the same step:

```bash
npm --prefix app/contracts run configure:external-bridge -- --config /secure/path/external-bridge.helium.json --step initialize --execute
```

```bash
npm --prefix app/contracts run configure:external-bridge -- --config /secure/path/external-bridge.helium.json --step routes --execute
```

8. Configure and start the backend, bridge service, signers, and rewards poller. Preserve `BRIDGE_ADDRESS=0000000000000000000000000000000000001008` while adding `EXTERNAL_ASSET_BRIDGE_ADDRESS=<EXTERNAL_ASSET_BRIDGE_PROXY>` and `TOKEN_ROUTER=<TOKEN_ROUTER_PROXY>`. The bridge operator OAuth account must resolve to the address configured in `ExternalAssetBridge.initialize`. Use independent signer keys/RPCs and ensure the configured signer count satisfies the vault threshold.

9. Test in this order: route quote, plain deposit, deterministic route fallback, successful deposit-and-route, routine withdrawal, large withdrawal requiring both threshold signatures and Safe approval, pause/unpause, RPC disagreement, missing receipt, reorg replacement, and expired authorization. Confirm the legacy bridge still processes its own in-flight operations.

10. Enable action 4 only for routes with verified quotes:

```bash
npm --prefix app/contracts run configure:external-bridge -- --config /secure/path/external-bridge.helium.json --step actions
```

Review the generated JSON, then have each required admin submit it:

```bash
npm --prefix app/contracts run configure:external-bridge -- --config /secure/path/external-bridge.helium.json --step actions --execute
```

11. Migrate test liquidity only after acceptance:

```bash
npm --prefix app/ethereum run external:vault:ops -- --config /secure/path/external-bridge-vault.helium-sepolia.json --chains 11155111 --step liquidity
```

Review the Safe JSON for token, amount, source Safe, destination vault, and remaining legacy liquidity, then propose:

```bash
npm --prefix app/ethereum run external:vault:ops -- --config /secure/path/external-bridge-vault.helium-sepolia.json --chains 11155111 --step liquidity --apply
```

Rollback is route-local: disable action 4, disable EAB deposits for the affected route or chain, keep withdrawals available where safe, and leave the legacy bridge/router untouched. Do not move new-vault liquidity back until pending new-bridge withdrawals are reconciled.

Keep pool, Forge, and vault reward activities registered against their existing source contracts. The poller correlates their TokenRouter-owned events with `RouteExecuted` and attributes direct routes to the caller; ExternalAssetBridge callers remain excluded because their canonical reward is `DepositCompleted`.

