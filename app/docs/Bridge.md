## Bridge

Purpose: cross-system token bridging into and out of STRATO.

This page describes the bridge architecture. For deployment commands, roles,
approval files, recovery and canaries, use the single canonical runbook:
[`EAB_DEPLOYMENT.md`](../../EAB_DEPLOYMENT.md). Do not use older
`setup`, `bundle`, `status`, `resume`, `vote` or `activate --approve` rollout
instructions.

### Components

- `ExternalAssetBridge`: STRATO coordinator for non-native assets.
- `ExternalBridgeVault`: external-chain custody and threshold-authorized release.
- `ExternalAssetDepositRouter`: external deposits and route intent.
- `TokenRouter`: bounded STRATO route execution.
- `StratoNativeBridge`: native-asset coordinator.
- `StratoNativeCustodyVault`: native custody on STRATO.
- `StratoNativeRepresentationBridge`: destination mint and redemption.
- `MercataBridge`: independent legacy bridge; it is not configured by the EAB rollout.

### Non-native bridge-in

1. Runtime detects a router event keyed by `(externalChainId, depositRouter, depositId)`.
2. Runtime and independent verifiers require the configured confirmation floor,
   canonical receipt/event evidence and finalized-chain evidence.
3. Verifiers record attestations for the exact settlement digest on STRATO.
4. Quorum allows the EAB to mint the reviewed representation amount. Routed
   deposits execute only through approved TokenRouter dependencies and preserve
   source-token fallback.
5. Duplicate, missing, conflicting or ambiguous evidence is rejected or sent to
   review; it cannot create a second settlement.

### Non-native bridge-out

1. `requestWithdrawal` escrows the STRATO token.
2. Routine withdrawals receive short-lived authorization from independent signers.
3. The executor reserves and releases route-local vault liquidity.
4. Independent verifiers attest the exact external release.
5. STRATO burns escrow only after attestation quorum. Large withdrawals also
   require Safe review; expired unpaid reservations use the attested refund flow.

### Native flows

Native flows use the same verifier workloads with separate native policies and
destination signing keys. Destination mint/refund attestations bind the signer-set
version. Every source-side custody release requires the configured
`StratoNativeBridge` verifier threshold.

### Operational invariants

- Deposit and withdrawal pause controls are independent.
- Every mint path consumes the reviewed token mint bucket.
- Testnet uses the configured testnet verifier quorum; production uses the
  configured production quorum. The rollout verifies the actual count rather than
  assuming three verifiers.
- Runtime and every verifier need explicit per-chain confirmation policies and
  independent RPC evidence. Numeric depth is a floor; settlement also requires
  canonical evidence at or below the finalized head.
- A new EAB chain is configured disabled. Services and readiness are verified
  before the separate activation approval.
- Native destination activation precedes source intake activation.
- Safe proposal journals and Runtime cursors live on persistent storage and must
  survive replacement.
- Run one proposal writer per shared Safe.
- Public intake stays closed until deposit and withdrawal canaries reconcile
  custody, escrow, representation supply and recipient balances.

### Deployment interface

The supported rollout commands are:

```bash
npm run external:rollout -- init --manifest <deployment.json> ...
npm run external:rollout -- preflight --manifest <deployment.json>
npm run external:rollout -- generate --manifest <deployment.json>
npm run external:rollout -- approve --file <admin-approval-ID.json>
npm run external:rollout -- verify --manifest <deployment.json>
npm run external:rollout -- activate --manifest <deployment.json>
```

`generate` reconciles live AdminRegistry, Cirrus, Safe and contract state, then
replaces `.deployment/current/` with only the current handoffs. Admin approval files
contain the exact current calls and expire after two hours. `approve --file`
rechecks live state, prints decoded calls and vote counts, and requires
`APPROVE <short-id>` before submission.

Admins keep no rollout history or activity trace. If a sequential governance
batch is interrupted, the Coordinator reruns `generate`; completed calls are
derived from live evidence and the replacement approval file contains only
incomplete calls. Safe MultiSend batches remain atomic and are regenerated
against the current Safe nonce after a failure.

### Security and configuration checks

- Verify source and destination chain IDs from live endpoints.
- Verify proxy implementations, owners, Safe threshold and every role address.
- Use at least two independent RPC hosts per verifier.
- Match Runtime/verifier policy hashes, confirmation floors, signer identities and
  on-chain thresholds before activation.
- Keep withdrawals disabled until a separate reviewed enablement change and
  withdrawal canary.
- Keep credentials, KMS references and bearer tokens in role-local secret stores;
  manifests and approval files contain no secrets.
- Preserve old signer versions until pending work is reconciled. A real
  membership or threshold change is required to rotate an on-chain version;
  writing an unchanged value does not rotate it.
