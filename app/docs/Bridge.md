## Bridge

Purpose: Cross-system token bridging into/out of Mercata.

Functional summary:
- Bridge-in (deposit): Off-chain relayer attests an external-chain deposit. The bridge records the deposit with replay protection and, upon confirmation, mints either USDST or the wrapped STRATO token to the recipient.
- Bridge-out (withdrawal): User escrows tokens on STRATO. Relayer creates and executes the custody transaction on the external chain; the bridge burns escrowed tokens and finalizes. A deterministic abort path refunds escrowed tokens if unprocessed after a timeout.

Key contracts:
- MercataBridge.sol: Handles deposit/withdraw workflows, tracking and mint/burn or escrow logic.

Trust model & guarantees:
- Trust model: A designated relayer coordinates verification and execution. No light-client; external finality and replay protection are enforced by the relayer and on-chain checks.
- Guarantees:
  - Canonical mint once per `(externalChainId, externalTxHash)` via replay protection
  - Escrowed withdrawal funds remain safe and are refundable via abort if not progressed
  - Independent circuit breakers for deposit and withdrawal legs

Flows and events:
- Deposit (Bridge-in):
  1) Relayer observes external deposit and calls `deposit(externalChainId, externalSender, externalTxHash, stratoToken, amount, stratoRecipient, mintUSDST)`
     - Checks: chain enabled; asset permissions; token active (or USDST mint path); unique `(chainId, txHash)`
     - Emits: `DepositInitiated(externalChainId, externalTxHash, stratoToken, amount, stratoRecipient, externalSender, mintUSDST)`
  2a) If verified OK: `confirmDeposit(externalChainId, externalTxHash)` → mints `USDST_ADDRESS` or `stratoToken` → `DepositCompleted`
  2b) If verification fails: `reviewDeposit(externalChainId, externalTxHash)` → `DepositPendingReview`

- Withdrawal (Bridge-out):
  1) User calls `requestWithdrawal(externalChainId, externalRecipient, stratoToken, amount, mintUSDST)`
     - Pulls escrow: `transferFrom(msg.sender, bridge, amount)` for USDST or `stratoToken`
     - Creates deterministic `withdrawalId` and stores `WithdrawalInfo`
     - Emits: `WithdrawalRequested(withdrawalId, destChainId, token, amount, user, dest, mint)`
  2) Relayer creates custody tx off-chain and calls `confirmWithdrawal(id, custodyTxHash)` → status `PENDING_REVIEW` → `WithdrawalPending`
  3) After execution on custody: `finaliseWithdrawal(id, custodyTxHash)` → burns escrow (USDST or token) → `WithdrawalCompleted`
  4) Abort path: `abortWithdrawal(id)`
     - Relayer may abort while `INITIATED|PENDING_REVIEW`
     - User may abort only while `INITIATED` and after `requestedAt + WITHDRAWAL_ABORT_DELAY (172800s)`
     - Refunds escrowed tokens and emits `WithdrawalAborted`

Permissions & registries:
- Assets are registered per `(stratoToken, externalChainId)` with:
  - `permissions` bitmask: `PERMISSION_WRAP=0b01`, `PERMISSION_MINT=0b10`
  - `maxPerTx` hard cap (0 = unlimited)
- Chains include custody, deposit router, `enabled`, and `lastProcessedBlock` hints.

Replay protection:
- Deposits keyed by `(externalChainId, externalTxHash)` must be unique; duplicates revert.

Pause & admin controls:
- `setPause(depositsPaused, withdrawalsPaused)`; `setRelayer`; `setTokenFactory`; `setUSDSTAddress`.

USDST vs wrapped tokens:
- `mintUSDST=true`: USDST minted/burned; otherwise the configured `stratoToken`.

Batch ops:
- `depositBatch`, `confirmDepositBatch`, `reviewDepositBatch`, `confirmWithdrawalBatch`, `finaliseWithdrawalBatch`, `abortWithdrawalBatch`.

Constraints & checks (selected):
- Chain enabled; asset exists; correct permissions for path; token activity rules; per-tx cap.

- Simulate full flows; verify event sequences, replay protection, permissions, and pause/abort.

Prod:
- Connect relayer and custody; enforce confirmation windows, review process, and monitor for anomalies. Use pause toggles during incidents.


