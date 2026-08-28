## Bridge

Purpose: Cross-system token bridging into and out of STRATO.

Key contracts:
- `ExternalAssetBridge`: STRATO coordinator for non-native assets.
- `ExternalBridgeVault`: Route-local custody and threshold-authorized releases on each external chain.
- `DepositRouter`: Emits uniquely numbered external deposits and transfers assets to the route vault.
- `StratoNativeBridge`: Unchanged native-asset bridge.
- `MercataBridge`: Legacy non-native history only while existing activity drains.

Non-native bridge-in:
1. The service detects every router event independently, keyed by `(externalChainId, depositRouter, depositId)`.
2. It waits for the configured confirmations and verifies the canonical receipt, exact router log and vault custody transfer.
3. Verified deposits call `settleDeposit`, which atomically records and completes the deposit while preserving `DepositInitiated` and `DepositCompleted`.
4. RPC conflicts, permanently missing receipts and expired settlement retries enter persistent review/quarantine.
5. Reviewed deposits are resolved through `confirmReviewedDeposit` or owner-governed `abortDeposit`.

`externalTxHash` is metadata, not replay identity. Multiple deposits in one external transaction settle and report action outcomes independently.

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
- Router rotation preserves prior router identities. Governance-aborted reorg observations may reuse the reverted deposit ID.


