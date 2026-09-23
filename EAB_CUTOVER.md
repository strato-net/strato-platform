# MercataBridge to ExternalAssetBridge cutover

This guide supplements [EAB_DEPLOYMENT.md](EAB_DEPLOYMENT.md). That procedure
deploys and activates the new bridge; this guide covers existing users, pending
transactions, custody, and retirement of the old bridge. It is a proposed
operational plan, not evidence that any network has completed these steps.

The cutover sequence is **drain → pause and verify → move backing → switch**.
Keep public bridge intake closed during the transition. Resolve all old deposits
and withdrawals before moving custody or activating EAB; parallel legacy
settlement after activation is not part of this plan. Legacy history remains readable.

## Current behavior and gaps

| Area | Current implementation | Cutover consequence |
| --- | --- | --- |
| New standard withdrawals | Unified Trade's `/trade/bridge/*` path approves EAB; legacy Fund's `/bridge/*` path remains on MercataBridge. | Deploying the new backend does not switch legacy pages. Gate old intake explicitly before draining and retiring it. |
| Legacy withdrawals | Service queries MercataBridge at `BRIDGE_ADDRESS`, proposes Safe transactions, then finalizes or aborts. | Keep the old contract address, custody, Safe access, and settlement worker available until drained. |
| Deposits | New service discovers chains/routers from EAB and processes EAB deposits. | It does not replace the old MercataBridge deposit processor. Drain old deposits before retiring that processor. |
| History | History is scoped by API path; legacy records remain on the legacy path and native records remain supported. | Preserve old contract queries and status links when retiring old entry points; the unified feed is not a replacement for every legacy record. |
| Backend startup | Requires configured EAB and TokenRouter, matching router linkage, and an initialized router. | Publish verified network defaults before deploying the new image; node `/health` alone is insufficient. |
| Pausing MercataBridge | Deposit confirmation, withdrawal confirmation, and withdrawal finalization require the respective side to be open. Legacy polling also filters `withdrawalsPaused=false`. | A global pause is not an intake-only stop. Pausing too early strands settlement. |
| External custody | EAB deployment uses a new vault; existing procedure specifies no liquidity migration. | Old Safe funds do not automatically become EAB withdrawal liquidity. |

Native bridge traffic is a separate path. Preserve its configuration and include
it in regression checks; do not redirect it as part of this cutover. Enabling
native routed redemptions additionally requires the
[native routing release gate](EAB_DEPLOYMENT.md#native-routing-release-gate).

## 1. Agree the cutover boundary

Owners: release coordinator, contract administrators, Safe owners, infra, support.

Create one reviewed inventory per STRATO network and external chain. Record:

- Decimal-string STRATO network ID, external chain ID, old/new image digests.
- MercataBridge, old external deposit entry points and custody addresses, EAB,
  TokenRouter, new DepositRouter, and new ExternalBridgeVault proxy addresses.
- Every token route: external token, STRATO token, decimals, rebase handling,
  action support, deposit/withdrawal limits, and old/new custody balances.
- Pending deposits, including external transfers not yet indexed on STRATO,
  pending review, and action deposits. Include transaction hashes and finality.
- Pending withdrawals: contract address, withdrawal ID, user, token, amount,
  status, Safe hash/nonce, and whether an external payment already executed.
- Service identities, Safe proposer and owner access, persistent data locations,
  indexer checkpoints, and the person responsible for each unresolved item.

Verify addresses and state from deployed contracts/Cirrus and external receipts.
Do not substitute implementation addresses for proxies or infer them from labels.
Use contract address plus withdrawal ID as identity; IDs can overlap across bridges.

Approve an intake cutoff, chain-specific finality requirements, a reconciliation
window, canary amounts, and acceptance criteria before execution. These are
network-specific decisions, not defaults supplied by this guide.

## 2. Prepare the new path without switching users

Prepare EAB deployment steps 0–5, respecting their pause and governance gates.
Defer Runtime startup in deployment step 6 until the old processors have stopped
at the end of cutover step 3. Then complete deployment steps 6–7 before moving
backing. Keep new external intake closed until activation. Do not upgrade or
repurpose an old custody vault as the new vault under this plan.

After governance, populate `defaultExternalAssetBridgeFor` and
`defaultTokenRouterFor` in `app/backend/src/config/config.ts` for the target
network using verified addresses. The current empty entries are release blockers.
Validate initialization and linkage before building the backend image.

Render the bridge/verifier configuration separately. Keep the old service and its
existing Safe configuration available for draining. Prepare the new service, but
do not start it alongside the old processor: it also starts legacy withdrawal
pollers. No worker-role split is needed for this sequential cutover.

The new service currently still requires legacy configuration, including
`BRIDGE_ADDRESS`. Retain valid configuration for startup. After the old bridge is
drained and paused, its withdrawal pollers should return no work because they
filter `withdrawalsPaused=false`. Verify that behavior before activation. Removing
those pollers and their configuration requirements is a separate code cleanup,
not a prerequisite for this cutover. Do not point the legacy Safe settings at
the new vault.

## 3. Stop old intake and drain

First remove old deposit instructions from the public UI and integrations. Pause
the old external deposit entry point only after verifying that its deployed
implementation supports an intake pause without blocking required processing.
Record the last accepted block and transaction. Direct transfers to a Safe may
remain possible even with a router paused: publish a late-transfer recovery
process and monitor the old custody addresses during the agreed window.

Keep the old deposit processor and MercataBridge deposit confirmation available
until every accepted transfer is finalized or refunded through an approved
process. An unresolved transfer blocks custody migration; assigning an owner
does not count as resolution. Do not replay an old deposit into EAB:
its observation identity and replay protection are separate, risking a second mint.

Remove old withdrawal submission from the public UI/integrations, then drain all
initiated and pending-review MercataBridge withdrawals through the Safe path.
Check both STRATO state and external receipts before retrying, rejecting, or
refunding. Never refund a withdrawal solely because the service lost its Safe
proposal record; establish whether payment executed first.

UI removal does not prevent direct contract calls, and MercataBridge's global
pause also blocks confirmation and finalization. Drain with settlement open,
monitor direct requests, then execute `setPause(true, true)` through the deployed
governance mechanism. Verify the deployed code matches these pause semantics.

After the pause is executed and indexed, re-query both queues and reconcile all
external transfers through the recorded cutoff with chain-specific finality.
Verify zero pending deposits, withdrawals, refunds, and escrow obligations, and
no outstanding Safe proposals that can still pay a legacy withdrawal. A Safe
proposal is not cancelled merely because the old service stops.

If a request arrived during draining, stop the cutover before moving backing.
Resolve it through a reviewed recovery procedure; reopening settlement can also
reopen intake, so repeat the pause and reconciliation afterward. If direct
requests prevent reaching a clean cutoff, an intake-only contract gate requires
separate implementation and testing before proceeding.

Only after this gate passes, stop the old processors and archive their final
checkpoints and reconciliation evidence. Now complete EAB deployment steps 6–7:
start the new Runtime with external intake paused and finish STRATO governance.
Verify legacy polling remains idle against the paused MercataBridge.

## 4. Reconcile custody and provide new withdrawal liquidity

With old intake paused and all old transactions resolved, reconcile the Safe's
external token balances against the backing for existing STRATO tokens. Record
all custody locations, including any hot Safe. Separate unrelated assets and
any explicitly retained recovery reserves from backing approved for transfer.

Prepare reviewed Safe transactions for each external chain and token, specifying
the source Safe, new ExternalBridgeVault proxy, exact raw amount, and execution
order. Safe owners verify and execute the transfers using the deployed token's
supported transfer mechanism. Confirm final receipts, the Safe's balance decrease,
and the vault's actual received balance increase before enabling withdrawals.
Resolve fees or transfer discrepancies before proceeding.

This is an explicit custody-migration phase in addition to EAB deployment. Keep
`migrateAmount="0"` in the base deployment bundle so it does not also move the
same backing. Retain the Safe transaction hashes and before/after balances as
cutover evidence; do not repeat a transfer based only on a service retry.

Verify EAB routes use the existing STRATO tokens, correct external tokens,
decimals, rebase configuration, and withdrawal limits. Verify the deployed vault
recognizes the received funds as available withdrawal liquidity. Moving backing
does not require minting replacement STRATO balances or moving users' holdings.

Gate: old obligations are cleared, migrated backing is reconciled, and the new
vault can fund the approved routes for existing holders.

## 5. Release and activate

Verify the new service is healthy and custody migration is reconciled before
activation. Verify its legacy pollers are idle against the paused
MercataBridge. Use the activation sequence and pause ordering in EAB deployment
step 8, keeping the public UI in maintenance until canaries pass. Before
public release, verify the backend image with target-network defaults serves
`/api/config` with HTTP 200, returns intended routes, and can quote supported
destinations. Verify on the same hostname users access, through the actual proxy.
The syncing screen can also mean backend configuration failure; inspect backend
logs instead of resetting a healthy node.

Stage the matching UI/backend pair for canary validation. New standard
withdrawals from the unified page target EAB; legacy pages remain on MercataBridge
until their intake is gated. Open public access only after step 6 passes and the
[application acceptance gate](EAB_DEPLOYMENT.md#application-release-and-fundtrade-cutover)
is complete. Retire Fund/old Trade only after acceptance, with redirects, parameter
translation, internal links, and navigation updated in the final cutover.
Check external deposit transactions target the reviewed new router and intended
vault. Remove stale deposit destinations from instructions, bookmarks under your
control, partner integrations, and cached app configuration. Old approvals do
not redirect themselves to the new contract; verify the UI requests approval for
the actual new spender.

Keep AUTO_ROUTE disabled unless separately approved and tested. If Save, Forge,
swap, or vault destinations are offered, verify the action-4 route and fallback
behavior rather than assuming old AUTO_SAVE/AUTO_FORGE settings carry over.

Preserve legacy transaction history and status links. After old intake is gated
and links/redirects are switched, new standard requests use EAB; legacy history
must remain reachable through its scoped API.

## 6. Acceptance evidence

Record hashes, balances, contract addresses, timestamps, and image digests for:

- New deposit: external receipt final, correct custody increase, exactly one
  STRATO credit; replay/retry does not mint again.
- New withdrawal: correct EAB request, external payment, reservation state, and
  STRATO settlement, following the canary accounting in EAB_DEPLOYMENT.md.
- Existing STRATO holder: a pre-cutover balance can use an approved new route
  when token mapping and new custody funding support it.
- Legacy drain: every accepted old deposit and withdrawal has a reconciled
  terminal outcome; no unaccounted Safe proposals or external payments remain.
- History: old/new records remain visible, statuses are correct, pagination
  retains both sources, and overlapping withdrawal IDs are not confused.
- App readiness: `/api/config`, route discovery, and intended quotes succeed;
  no crash loop or recurring 502; native routes still work.
- Actions, if enabled: signed output minimums, destination credit, and bridged
  source-token fallback on route failure are verified.

After all checks pass, reopen public bridge access and monitor new transactions
and old custody addresses. Do not declare completion solely from a green service
health endpoint.

## 7. Failure and rollback

Before backing moves, rollback may mean restoring old UI/backend images
and the old processor, provided the old contracts and custody remain usable.
After backing moves, even without new user transactions, restore and reconcile
old custody funding before reopening the old bridge. Reopening intake requires
coordinator and governance approval.

After new transactions exist, rollback is a settlement operation as well as an
image rollback. Stop new intake with reviewed pause controls, inventory all EAB
deposits, withdrawals, reservations, and payments, and preserve their workers,
credentials, logs, and persistent state. Review which settlement calls each pause
blocks. Do not replay EAB deposits into MercataBridge or blindly re-enable old
withdrawals after custody moved. Restore old routing only after proving funding
and exclusive worker ownership on both paths.

Keep an incident ledger for nonterminal transactions. Resolve executed external
payments before any refund; preserve evidence through service replacement.
Do not wipe node or bridge-service state as a remedy for an application failure.
If a node restart is independently necessary, follow the repository's full node
lifecycle rules; bridge-service reconciliation data must be retained separately.

## 8. Retire the old path

After the approved late-arrival window, require zero unexplained old deposits,
withdrawals, Safe proposals, and custody differences. Verify old intake is closed.
The old processors were stopped before migration; they are not retained for
parallel settlement. After the observation window, revoke permissions no longer
needed, checking that the new service still satisfies its startup requirements.
Any unexpected legacy obligation is an incident requiring reconciliation, not
normal parallel operation.

Keep MercataBridge history readable and retain its address in backend queries.
Archive the inventory, cutoff blocks, receipts, balances, governance issues,
configuration revisions, and recovery ownership. Document how a later direct
transfer to old custody will be handled.

## Implementation references

- `app/backend/src/api/services/bridge.service.ts`: new withdrawal target,
  combined history, and legacy status normalization.
- `app/backend/src/config/config.ts`: network defaults and startup validation.
- `app/services/bridge/src/polling/stratoPolling.ts`: legacy and EAB pollers.
- `app/services/bridge/src/services/cirrusService.ts`: contract/address filters
  and paused-bridge exclusion.
- `app/services/bridge/src/services/bridgeService.ts`: Safe confirmation and
  MercataBridge finalization.
- `app/services/bridge/src/utils/safeHelper.ts`: configured legacy custody.
- `app/contracts/concrete/Bridge/MercataBridge.sol`: pause guards and settlement.

Before executing this plan, verify these behaviors against the exact deployed
contract implementations and service image revisions, not only this checkout.
