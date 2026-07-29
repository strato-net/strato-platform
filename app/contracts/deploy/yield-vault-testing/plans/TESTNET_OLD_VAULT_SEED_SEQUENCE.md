# YieldVaultOld testnet seed sequence

## Purpose

Create a deterministic, production-like state in a `YieldVaultOld.sol` proxy before upgrading it to `YieldVault.sol`.

Before this script runs, fund all actors through [`TESTNET_ACTOR_FUNDING_SEQUENCE.md`](./TESTNET_ACTOR_FUNDING_SEQUENCE.md) and provide its completed funding manifest.

The seeded vault contains:

- Three shareholders.
- One approved strategy.
- Historical realized profit and reported loss.
- A partially processed head request.
- A second FIFO request.
- A fixed claim liability.
- Nonzero idle and deployed assets.
- A nondefault idle-reserve policy.

The script must stop on the first failed transaction or failed assertion and write every address, transaction hash, event, and final snapshot to a JSON manifest consumed by the post-upgrade E2E script.

If an asynchronous STRATO receipt does not expose a Solidity return value, use the emitted event and verified pre/post-state deltas as the authoritative result.

## Scope and assumptions

- Testnet only.
- The underlying is a standard 18-decimal ERC-20 with no transfer fee, rebase, seizure, or callback.
- All values below are whole underlying tokens. `U = 10^18`.
- Every transaction must be submitted by the actor identified for that step.
- `OWNER_ADDRESS` is the authenticated EOA; `VAULT_OWNER_ADDRESS` is the
  proxy/vault storage owner. Governed Helium runs require AdminRegistry
  `000000000000000000000000000000000000100c` plus nonzero live
  `adminMap[OWNER_ADDRESS]`; direct-owner mode remains supported.
- `DEPLOYER_ADDRESS` is a distinct authenticated EOA used only for
  `createContract`. On Helium it must be `Admin #1`, and governed
  runs require nonzero live `adminMap[DEPLOYER_ADDRESS]`. OWNER still activates
  the implementation and performs every vault `onlyOwner` call.
- Every owner call is explicitly registry-marked `onlyOwner/governed`. Bind
  `IssueCreated` to the submission hash and exact target/function/arguments,
  print and persist its issue ID/block/timestamp, then accept only the exact
  newer matching `IssueExecuted`. Verify its receipt, target events, and
  post-state under the execution hash before continuing.
- `YieldVaultOld.sol` defines the implementation contract as `YieldVault`.
- `BaseCodeCollection.sol` imports the new implementation. Deploy the old implementation by combining `YieldVaultOld.sol` directly, or through a dedicated source file that imports only the old implementation.
- Deploy the old implementation behind `Proxy`; call `initialize` through the proxy, never on the implementation.
- The proxy owner and vault owner storage must resolve to the intended testnet owner/governance account.
- Do not send any untracked underlying directly to the proxy.
- Use the YieldVault-local deployment workflow, which submits with `isAsync: true`, polls `rest.getBlocResults`, and asserts the final receipt status before reading post-state.

## Recoverable execution requirements

The seed script must be resumable. A checkpoint ID means:

```text
All operations before CHECKPOINT_ID are confirmed.
CHECKPOINT_ID is the next operation that may need execution or reconciliation.
```

Required CLI shape:

```bash
node seed-yield-vault-old.js \
  --run-state <path-to-run-state.json> \
  [--checkpoint <CHECKPOINT_ID>]
```

The checkpoint map is part of the script's public interface and must remain stable after a run begins.

### Persistent run-state journal

Before submitting every state-changing transaction, atomically write:

```text
schemaVersion
scriptVersion or source hash
network and NODE_URL identity
actor funding-manifest hash
seed configuration hash
checkpointId
operation name
actor address
contract address
method and arguments
expected pre-state snapshot
expected post-state snapshot or post-state rules
status = ready
```

Immediately after submission, atomically add:

```text
transaction hash, if returned
submitted nonce/account sequence, if available
submission timestamp
status = submitted
governance issue ID, if returned
```

After the receipt and state assertions succeed, write:

```text
receipt
confirmed block number and timestamp
observed events
confirmed post-state snapshot
status = confirmed
nextCheckpointId
```

Then print:

```text
CHECKPOINT_CONFIRMED checkpoint=<CHECKPOINT_ID> next=<NEXT_CHECKPOINT_ID> runState=<absolute-path>
```

Never store passwords, OAuth tokens, private keys, or other credentials in the journal.

### Sixty-second polling boundary

Poll each transaction or governance execution for at most `60` seconds per script invocation.

If it does not reach a definitive terminal state:

1. Keep the current checkpoint unconfirmed.
2. Preserve the transaction hash, nonce, issue ID, and latest observed status.
3. Print exactly one machine-readable terminal line:

```text
CHECKPOINT_STOP checkpoint=<CHECKPOINT_ID> runState=<absolute-path> reason=<timeout|nonce_collision|pending_governance|unknown_status> txHash=<hash-or-none>
```

4. Exit nonzero without submitting any later transaction.

The operator can later resume with the printed checkpoint ID.

For every governed checkpoint, the primary OWNER call first persists the exact
`IssueCreated`. The script then journals APPROVER intent/account sequence and
submits the identical vault target/function/arguments using APPROVER. It never
calls `AdminRegistry.castVoteOnIssue`. The APPROVER raw payload, hash, nonce,
receipt, exact `IssueExecuted`, target events, and post-state are verified.
Resumption reuses the saved primary and approval hashes; hashless approval
recovery is by APPROVER nonce only and otherwise fails closed.

### Mandatory resume assertion

When `--checkpoint N` is supplied, the first executed function must be:

```text
assertCheckpointState(N, runState)
```

It must verify:

- Network, proxy, implementation, asset, actor addresses, decimals, constants, actor funding manifest, and script/config hashes match the journal.
- The proxy implementation is the implementation expected at checkpoint `N`.
- Every deterministic vault field, token balance, share balance, allowance, strategy debt, queue link, request, and claim equals the saved expected state.
- Derived accounting identities for that checkpoint hold.
- No later checkpoint is already recorded as confirmed.

If the previous transaction has an ambiguous status, reconcile before resubmission:

1. If the exact saved pre-state remains and the transaction is definitively failed or absent, refresh the nonce/account sequence and permit one new submission.
2. If the exact expected post-state exists, treat the operation as confirmed and advance to the next checkpoint without resubmitting it.
3. If the transaction or governance issue is still pending, resume polling the same hash/issue ID; never submit a duplicate.
4. If neither exact pre-state nor exact post-state exists, print `CHECKPOINT_STATE_MISMATCH` with field-level differences and exit for manual investigation.

A nonce collision is not evidence that the intended transaction failed. The script must refresh nonce state and reconcile contract state before deciding whether resubmission is safe.

Use a lock file tied to the run-state path so two seed processes cannot resume the same run concurrently.

If the run-state file already contains an unfinished run and no `--checkpoint` is supplied, refuse to start over and print the required resume checkpoint. If checkpoint `190` is already confirmed, reassert the final state and exit successfully without sending transactions.

### Seed checkpoint registry

```text
001  deploy empty proxy, when Optional Phase 0 is enabled
002  deploy/activate YieldVaultOld implementation
100  initialize or validate the empty old proxy
110  verify ALICE funding-manifest balance
111  verify BOB funding-manifest balance
112  verify CAROL funding-manifest balance
120  ALICE asset approval
121  ALICE deposit
122  BOB asset approval
123  BOB deposit
124  CAROL asset approval
125  CAROL deposit
130  set minimum idle basis points
131  approve STRATEGY
140  first deployment to STRATEGY
150  verify STRATEGY prefunded profit budget
151  STRATEGY asset approval
152  return STRATEGY principal and profit
160  second deployment to STRATEGY
170  transfer STRATEGY loss to LOSS_SINK
171  report STRATEGY loss
180  create ALICE request
181  create BOB request
182  partially process queue head
190  assert final seed state and write handoff manifest
```

Seed checkpoints `110`-`112` are read-only funding-manifest assertions; the
seed script must not mint or top up actors.

## Required actors and addresses

The script takes or creates:

- `OWNER`: vault administration and proxy-upgrade authority.
- `ALICE`: first depositor and queue head.
- `BOB`: second depositor and second queue entry.
- `CAROL`: depositor who remains fully liquid.
- `STRATEGY`: realizes profit, receives a second deployment, and realizes a loss.
- `LOSS_SINK`: receives tokens removed from `STRATEGY` to simulate physical loss.
- `ASSET`: underlying ERC-20.
- `OLD_IMPLEMENTATION`: deployed `YieldVaultOld.sol` implementation.
- `VAULT_PROXY`: proxy pointing to `OLD_IMPLEMENTATION`.

All actor addresses must be distinct. `STRATEGY` may not equal the proxy or any later reward distributor.

## Optional Phase 0: deploy the old testnet proxy

Required environment:

```text
NODE_URL
OAUTH_URL
OAUTH_CLIENT_ID
OAUTH_CLIENT_SECRET
EXPECTED_NETWORK_ID
REQUIRE_TESTNET=true
OWNER_USERNAME
OWNER_PASSWORD
OWNER_ADDRESS
DEPLOYER_USERNAME
DEPLOYER_PASSWORD
DEPLOYER_ADDRESS
EXPECTED_PROXY_SOURCE_HASH
EXPECTED_OLD_REVIEWED_SOURCE_HASH
```

Use lowercase 40-hex-character STRATO addresses without `0x`.

`EXPECTED_PROXY_SOURCE_HASH` is SHA-256 over the exact normalized in-memory
combined source produced from `concrete/Proxy/Proxy.sol`;
`EXPECTED_OLD_REVIEWED_SOURCE_HASH` is the same operation over
`deploy/yield-vault-testing/YieldVaultOld.sol`. The canonical normalization and hash
command are documented in
`../README.md`. Independently review both combined
strings.

To create the old test fixture with the guarded YieldVault-local workflow:

```bash
cd mercata/contracts

npm run yield-vault:deploy-old-proxy -- \
  --expected-owner <VAULT_OWNER_ADDRESS> \
  --run-state ./yield-vault-old-proxy-run-state-cirrus.json \
  --evidence-output ./yield-vault-old-proxy-evidence-cirrus.json
```

Proxy `917e95e65bf009dd17610d3b68052c05d91ffb7b` and implementation
`f4c539b8f15fa2ea059ad8457b8d882e5bf3ee35` were created by
`Admin #2` and are abandoned because they are not Cirrus-indexed for
this workflow. Never approve issue
`cfb8808c4c13a7dea92b41fe673b7763db45a9c96dc10bdfd6a2883291c460d9`.
After local artifact cleanup, only the fresh paths above may be used.

Record the evidence artifact's proxy as `VAULT_PROXY` and implementation as
`OLD_IMPLEMENTATION`. The artifact must be `schemaVersion: 2`, type
`yield-vault-old-proxy-deployment`, completed, and bind both combined hashes to
their independently expected reviewed hashes. Use only this YieldVault-local
command; the shared proxy deploy command does not produce the required
evidence.

DEPLOYER submits the exact AdminRegistry `createContract(name, combinedSource,
constructorArgs)` issues for Proxy and YieldVaultOld. Approve each exact printed
issue and rerun without changing paths. OWNER then submits the governed
`setLogicContract`. Read the proxy `logicContract` state field and require it
equals `OLD_IMPLEMENTATION` before proceeding. Evidence must record DEPLOYER on
both deployments and OWNER on activation.

The old implementation is intentionally compiled from `YieldVaultOld.sol`, not `BaseCodeCollection.sol`; the latter imports the new implementation.

## Constants

```text
U                      = 1000000000000000000
MAX_UINT256            = 2^256 - 1

ALICE_DEPOSIT          = 200 * U
BOB_DEPOSIT            = 150 * U
CAROL_DEPOSIT          = 100 * U

FIRST_DEPLOY           = 300 * U
STRATEGY_PROFIT        = 20 * U
STRATEGY_RETURN        = 320 * U
SECOND_DEPLOY          = 220 * U
STRATEGY_LOSS          = 20 * U

ALICE_REQUEST          = 120 * U
BOB_REQUEST            = 80 * U
FIRST_PROCESS_BUDGET   = 50 * U

MIN_IDLE_BPS           = 1000
```

## Phase 1: validate or initialize the old proxy

Read the proxy `logicContract` state field with `rest.getState` and require:

```text
logicContract == OLD_IMPLEMENTATION
```

If the proxy is fresh, call as `OWNER`:

```text
YieldVault(VAULT_PROXY).initialize(
  asset_  = ASSET,
  name_   = "Testnet Legacy Yield Vault",
  symbol_ = "tLEGACY-YV"
)
```

Require:

```text
asset()              == ASSET
vaultInitialized()   == true
totalAssets()        == 0
totalSupply()        == 0
deployedAssets()     == 0
nextRequestId()      == 1
paused()             == false
```

If already initialized, abort unless every value is the expected empty state. Never call `initialize` twice.

## Phase 2: verify funding and deposit

Load the completed funding manifest and require the actors currently hold at least:

```text
ALICE: 200 * U
BOB:   150 * U
CAROL: 100 * U
```

From each user, call:

```text
ASSET.approve(VAULT_PROXY, MAX_UINT256)
```

Then call:

```text
ALICE -> deposit(200 * U, ALICE)
BOB   -> deposit(150 * U, BOB)
CAROL -> deposit(100 * U, CAROL)
```

Require:

```text
balanceOf(ALICE)       == 200 * U
balanceOf(BOB)         == 150 * U
balanceOf(CAROL)       == 100 * U
totalSupply()          == 450 * U
underlying idle        == 450 * U
deployedAssets()       == 0
totalAssets()          == 450 * U
exchangeRate()         == 1 * U
```

## Phase 3: configure strategy and idle policy

As `OWNER`, call:

```text
setMinIdleBps(1000)
setStrategyApproval(STRATEGY, true)
```

Require:

```text
minIdleBps()                  == 1000
approvedStrategies(STRATEGY) == true
```

## Phase 4: create strategy history

### 4.1 Initial deployments

As `OWNER`, call:

```text
deployCapital(STRATEGY, 300 * U)
```

Require:

```text
idle                     == 150 * U
strategyDebt(STRATEGY)   == 300 * U
deployedAssets()         == 300 * U
totalAssets()            == 450 * U
```

Verify the strategy token balance increases by exactly `300 * U`.

### 4.2 Realize `20` tokens of profit

Do not mint during the seed run. The funding manifest already includes the profit budget. After receiving the `300 * U` deployment, require `STRATEGY` has at least `320 * U` available.

From `STRATEGY`, call:

```text
ASSET.approve(VAULT_PROXY, 320 * U)
```

As `OWNER`, call:

```text
returnCapital(STRATEGY, 320 * U)
```

Verify the strategy token balance decreases by exactly `320 * U`.

Require:

```text
strategyDebt(STRATEGY) == 0
deployedAssets()       == 0
idle                   == 470 * U
totalAssets()           == 470 * U
totalSupply()           == 450 * U
```

Require a `CapitalReturned` event with:

```text
assetsReturned  = 320 * U
principalRepaid = 300 * U
realizedProfit  = 20 * U
strategyDebt    = 0
totalDeployed   = 0
```

### 4.3 Redeploy to the strategy

As `OWNER`, call:

```text
deployCapital(STRATEGY, 220 * U)
```

Verify the strategy token balance increases by exactly `220 * U`.

Require:

```text
idle                   == 250 * U
strategyDebt(STRATEGY) == 220 * U
deployedAssets()       == 220 * U
totalAssets()          == 470 * U
```

### 4.4 Realize `20` tokens of loss

From `STRATEGY`, transfer:

```text
ASSET.transfer(LOSS_SINK, 20 * U)
```

Verify the strategy balance decreases by exactly `20 * U` and remains at least `200 * U`.

As `OWNER`, call:

```text
reportStrategyLoss(STRATEGY, 20 * U)
```

Require:

```text
idle                   == 250 * U
strategyDebt(STRATEGY) == 200 * U
deployedAssets()       == 200 * U
totalAssets()          == 450 * U
totalSupply()          == 450 * U
exchangeRate()         == 1 * U
```

The profit and loss deliberately net to zero so the queued state below has exact integer pricing while still preserving both historical event classes.

## Phase 5: create FIFO queue and fixed claim history

From `ALICE`, call:

```text
requestRedeem(120 * U, ALICE, ALICE)
```

Require request ID `1`.

From `BOB`, call:

```text
requestRedeem(80 * U, BOB, BOB)
```

Require request ID `2`.

Before processing, require:

```text
queueHead()          == 1
queueTail()          == 2
nextRequestId()      == 3
totalQueuedShares()  == 200 * U
totalSupply()        == 450 * U
balanceOf(VAULT_PROXY) == 200 * U
underlying idle      == 250 * U
```

As `OWNER`, call:

```text
processQueue(
  maxRequests = 1,
  maxAssets   = 50 * U
)
```

Require the return values and `QueueProcessed` event to report:

```text
processedRequests = 1
burnedShares      = 50 * U
reservedAssets    = 50 * U
requestId         = 1
fullyProcessed    = false
```

## Phase 6: assert the exact seeded state

Require:

```text
paused()                       == false
idle                           == 250 * U
deployedAssets()               == 200 * U
strategyDebt(STRATEGY)         == 200 * U
totalAssets()                  == 450 * U

totalSupply()                  == 400 * U
balanceOf(ALICE)               == 80 * U
balanceOf(BOB)                 == 70 * U
balanceOf(CAROL)               == 100 * U
balanceOf(VAULT_PROXY)         == 150 * U

queueHead()                    == 1
queueTail()                    == 2
nextRequestId()                == 3
totalQueuedShares()            == 150 * U
activeRequestId(ALICE)         == 1
activeRequestId(BOB)           == 2

requests(1).shares             == 70 * U
requests(1).receiver           == ALICE
requests(1).next               == 2
requests(1).exists             == true

requests(2).shares             == 80 * U
requests(2).receiver           == BOB
requests(2).next               == 0
requests(2).exists             == true

claimableAssets(ALICE)         == 50 * U
claimableAssets(BOB)           == 0
totalClaimableAssets()         == 50 * U

activeAssets()                 == 400 * U
exchangeRate()                 == 1 * U
freeIdleForInstantWithdrawals()== 0
freeIdleForQueueProcessing()   == 200 * U
maxDeploy()                    == 0
minIdleBps()                   == 1000
```

Also verify:

```text
deployedAssets == strategyDebt(STRATEGY)
totalQueuedShares == requests(1).shares + requests(2).shares
totalClaimableAssets == claimableAssets(ALICE) + claimableAssets(BOB)
totalSupply == balanceOf(ALICE) + balanceOf(BOB) + balanceOf(CAROL) + balanceOf(VAULT_PROXY)
totalAssets == idle + deployedAssets
activeAssets == totalAssets - totalClaimableAssets
```

## Phase 7: hand off to the safe upgrade runbook

Do not pause in the seed script. Require:

```text
paused() == false
```

Immediately continue with [`SAFE_UPGRADE_RUNBOOK.md`](./SAFE_UPGRADE_RUNBOOK.md). That runbook owns the authoritative pre-upgrade snapshot, pause, implementation upgrade, accrual initialization, distributor configuration, unpause, and controlled smoke test.

Do not allow any user, strategy, or token transfer to mutate the seeded state between this handoff and the runbook's initial snapshot.

## Seed manifest

Write a machine-readable JSON manifest with `schemaVersion: 1`, type
`yield-vault-old-seed`, containing:

- Network and block number.
- Funding-manifest hash and requested run count.
- All actor addresses.
- `ASSET`, `OLD_IMPLEMENTATION`, and `VAULT_PROXY`.
- Asset decimals and `U`.
- Every transaction hash and emitted event.
- The complete Phase 6 state.
- The final unpaused seed snapshot and its block number.
- The expected next request ID (`3`).
- The expected gross economic assets (`450 * U`).
- The expected active assets (`400 * U`).
- The expected exchange rate (`1 * U`).
- Run-state schema/script hashes and the complete checkpoint/receipt history.
- Confirmation that checkpoint `190` completed.

The safe upgrade runbook must refuse to proceed if its initial live snapshot differs from this manifest.

Run the exact offline seed/recovery validations from `mercata/contracts`:

```bash
npm run yield-vault:test-faults
npm run yield-vault:test-tooling
```
