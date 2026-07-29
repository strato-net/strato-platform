# YieldVault testnet actor funding sequence

## Purpose

Define a script that mints the full token allocation for every actor needed by:

1. [`TESTNET_OLD_VAULT_SEED_SEQUENCE.md`](./TESTNET_OLD_VAULT_SEED_SEQUENCE.md)
2. [`SAFE_UPGRADE_RUNBOOK.md`](./SAFE_UPGRADE_RUNBOOK.md)
3. [`TESTNET_UPGRADE_E2E_SEQUENCE.md`](./TESTNET_UPGRADE_E2E_SEQUENCE.md)

The default allocation must support at least `10` complete seed-upgrade-E2E runs without relying on assets returned by an earlier run.

A fresh output path mints the full requested allocation. Existing balances do
not reduce mint amounts. Re-running an incomplete output resumes its exact
checkpoint/issue; re-running a completed output only reasserts; a new output
path starts another full allocation.

## Scope and assumptions

- Testnet only.
- All ten runs use the same standard 18-decimal underlying token and actor addresses.
- Each run uses a new vault proxy seeded from an empty state.
- A run may leave shares or underlying locked in its vault; no later run depends on recovering them.
- The underlying has no fee, rebase, seizure, or callback.
- Each token owner must equal `MINTER` directly or AdminRegistry
  `000000000000000000000000000000000000100c`; the latter requires nonzero live
  `adminMap[MINTER]`.
- If `MINTER` lacks mint authority for either token, abort before any transaction.
- STRATO transaction fees are paid in `FEE_TOKEN`, normally USDST.
- `MINTER` must begin with enough bootstrap fee balance to submit its first fee-token mint transaction.
- The reviewed `fee-policy.js` entry, not generic network metadata, is
  authoritative for the fee-token address and fee amount. The currently
  reviewed Helium policy is `0.01 USDST` per contract call.
- Use lowercase 40-hex-character STRATO addresses without `0x`.

Before validation and immediately before every mint, select the reviewed policy
by exact network ID, read exactly one
`DeciderState.currentFeeContract` storage row at its reviewed state address,
decode the active fee-contract address, then read exactly one account row for
that address. Require the live pointer, account address, 64-hex `codeHash`,
requested fee-token address, and fee amount to equal the reviewed policy.
Unknown networks, changed pointers/code hashes, malformed responses, or fee
token mismatches fail closed. After each mint, the actual MINTER fee-token
debit must be either zero for voucher payment or exactly the reviewed fee.

## Required CLI

```bash
node fund-yield-vault-test-actors.js \
  --asset <UNDERLYING_ASSET> \
  --fee-token <USDST_OR_NETWORK_FEE_TOKEN> \
  --runs 10 \
  --actors <path-to-actors.json> \
  --output <path-to-funding-manifest.json>
```

Require:

```text
runs >= 10
asset.decimals() == 18
feeToken.decimals() == 18
```

## Required actors

The actors file must contain:

```text
MINTER
OWNER
ALICE
BOB
CAROL
STRATEGY
LOSS_SINK
SMOKE_USER
REWARD_DISTRIBUTOR
DONOR
DAVE
```

All functional actors must match the addresses later written into the seed manifest and runbook report.

Vault users, strategy, sink, distributor, donor, and smoke actors must satisfy the distinct-address requirements in the seed plan. `MINTER` may equal `OWNER`.

`LOSS_SINK` receives lost tokens but submits no transactions. `OWNER` requires fee funding but no underlying funding. `STRATEGY` receives principal from the vault but requires prefunded underlying for realized profit.

## Underlying budget derivation

Let:

```text
N = requested run count
U = 10^18
```

Gross underlying required per run:

```text
ALICE              = 200 * U
BOB                = 150 * U
CAROL              = 100 * U
STRATEGY           = 30 * U
SMOKE_USER         = 10 * U
REWARD_DISTRIBUTOR = 30 * U
DONOR              = 5 * U
DAVE               = 25 * U
```

Why:

- `ALICE`, `BOB`, and `CAROL` fund the seeded deposits.
- `STRATEGY` supplies `20` tokens of seeded profit and `10` tokens of post-upgrade profit. Its two `20`-token losses are transfers out of deployed principal.
- `SMOKE_USER` funds the runbook's `10`-token round trip.
- `REWARD_DISTRIBUTOR` provides a `30`-token funded-accrual budget.
- `DONOR` sends the deliberate `5`-token donation.
- `DAVE` funds the `25`-token post-upgrade deposit.

Per-run total:

```text
550 * U
```

For the required default `N = 10`, underlying mint amounts are:

```text
ALICE              = 2000 * U
BOB                = 1500 * U
CAROL              = 1000 * U
STRATEGY           = 300 * U
SMOKE_USER         = 100 * U
REWARD_DISTRIBUTOR = 300 * U
DONOR              = 50 * U
DAVE               = 250 * U

TOTAL              = 5500 * U
```

No underlying is minted to:

```text
OWNER
LOSS_SINK
MINTER, unless MINTER is also one of the funded actors
```

For arbitrary `N >= 10`:

```text
mintAmount(actor) = perRun(actor) * N
```

Do not subtract expected claims, redemptions, donations received by the distributor, or other recoveries. The budget must remain sufficient if every prior run's contributed assets are unavailable.

## Fee-token mint amounts

For `N = 10`, mint:

```text
OWNER              = 10 * U
MINTER              = 2 * U, when distinct from OWNER
ALICE               = 2 * U
BOB                 = 2 * U
CAROL               = 2 * U
STRATEGY            = 2 * U
SMOKE_USER          = 2 * U
REWARD_DISTRIBUTOR  = 2 * U
DONOR               = 2 * U
DAVE                = 2 * U
LOSS_SINK           = 0
```

These amounts intentionally exceed the calls currently assigned to each actor.

For `N > 10`, scale every nonzero amount proportionally and round up:

```text
scaledMintAmount = ceil(baseMintAmountForTenRuns * N / 10)
```

`DEPLOYER` must cover Proxy, YieldVaultOld, and new YieldVault
`createContract` submissions; on Helium DEPLOYER equals MINTER
(`Admin #1`), so the existing maximum-per-address rule applies. `OWNER`
must cover pointer governance, runbook, and E2E administration. If governance
voting accounts pay their own fees, include them as additional fee-funded
actors.

When one address fills multiple roles, use the maximum applicable fee-token amount, not the sum. For example, `MINTER == OWNER` receives the `OWNER` amount.

## Mint execution

The script derives a locked run-state at `<output>.run-state.json`. It has one
checkpoint per mint, no deficit calculation, and no transfer fallback.

Before submitting any transaction:

1. Validate the network, token addresses, actor addresses, decimals, reviewed
   Decider pointer/code-hash fee policy, and `runs`.
2. Verify direct ownership or live AdminRegistry membership for both tokens.
3. Verify `MINTER` has enough existing `FEE_TOKEN` to submit its first mint.
4. Read and record every planned recipient balance and each token's `totalSupply`.
5. Build the complete mint plan.

Build fee-token amounts by actor role first. If one address fills multiple roles, keep the maximum role amount. Then key the complete plan by `(token, recipient)` and sum entries when `ASSET == FEE_TOKEN`.

Execute the plan sequentially:

1. Mint the aggregated `(FEE_TOKEN, MINTER)` entry first.
2. Mint the remaining fee-token entries.
3. Mint the underlying entries not already aggregated into a fee-token entry.

For each nonzero plan entry, call as `MINTER`:

```text
Token(token).mint(recipient, mintAmount)
```

Journal before submission, including account sequence and exact arguments. In
governed mode, bind `IssueCreated` to the submission hash and exact
target/function/arguments, print the issue ID immediately, atomically journal
APPROVER intent and pre-submission sequence, then call the same
`Token(token).mint(recipient, mintAmount)` with APPROVER. Do not call
`AdminRegistry.castVoteOnIssue`. Verify the APPROVER raw payload/hash/nonce/
receipt and exact newer matching `IssueExecuted`, then evaluate mint event/state
under that execution hash. Resume a saved approval hash without duplication;
recover a hashless approval only by the saved APPROVER nonce or fail closed. In
direct-owner mode, evaluate the primary submission receipt/hash directly. Then
require:

```text
totalSupplyAfter - totalSupplyBefore == mintAmount
exact Transfer(address(0), recipient, mintAmount) event exists

for every entry except (FEE_TOKEN, MINTER):
  balanceAfter - balanceBefore == mintAmount

for (FEE_TOKEN, MINTER):
  balanceAfter - balanceBefore == mintAmount - proven feePaymentDebit
  feePaymentDebit == 0 or reviewed feeWei
```

Stop on the first failed transaction or assertion and do not write a completed
funding manifest. Preserve the run-state. The same output resumes the unfinished
checkpoint; only a fresh output path starts another full allocation.

Run this script only before a seed-upgrade-E2E sequence begins. Do not fund actors while a sequence is active because deployed principal could be mistaken for prefunded strategy profit.

## Final assertions

Require:

```text
sum of configured underlying mint amounts == 550 * U * N
every non-MINTER recipient balance increase == its aggregated mint amount
MINTER fee-token final delta == gross fee-token mint - proven fee debits
no unexpected actor received underlying
```

If `ASSET != FEE_TOKEN`, require:

```text
asset totalSupply increase == total underlying minted
feeToken totalSupply increase == total fee tokens minted
```

If `ASSET == FEE_TOKEN`, require:

```text
token totalSupply increase == total underlying minted + total fee tokens minted
```

## Funding manifest

Write a JSON manifest with `schemaVersion: 2` containing:

- Network identity and block.
- Asset and fee-token addresses, names, symbols, and decimals.
- Reviewed fee-policy record plus the observed Decider pointer and active
  fee-contract code hash used to prove the fee-token address and fee amount.
- Requested run count.
- Actor addresses.
- Per-run budgets and computed mint amounts.
- The aggregated `(token, recipient)` mint plan.
- Initial balances, minted amounts, and final balances.
- Mint authority address.
- Transaction hashes, receipts, and events.
- Script/config hashes.
- Confirmation that every planned mint and final assertion completed.

The completed manifest references its derived run-state and configuration hash.
Partial progress exists only in the locked run-state, never as a completed
manifest.
It is written only after all mints and final assertions succeed.

The seed script must consume this manifest and refuse to start if:

- Network, asset, or actor addresses differ.
- `runs < 10`.
- Any required actor balance is below the allocation recorded in the manifest.
- The funding manifest is incomplete or any planned mint/final assertion is unconfirmed.

Run the exact offline validation from `mercata/contracts`:

```bash
npm run yield-vault:test-funding
```
