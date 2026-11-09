# Port: Safe `VestingPool` on SolidVM for $STRATO vesting

_Handoff for strato-platform. Written 2026-10-30 on branch `feature/safe-vesting-pool-port` from `develop` at 3e6b7749da. Every fact marked **verified** was checked in the session that produced this branch (source diffs, upstream commit history, the Ackee audit summary, and `solid-vm-cli` probes). Decisions marked as questions are open; everything else is final unless the owner reopens it._

## 1. Goal

One vesting pool on STRATO mainnet that holds the locked part of the 100,000,000 $STRATO supply and releases it per the tokenomics sheet ("Tokenomics STRATO draft v2.2s"), with these properties:

- one contract, many vestings, 50+ beneficiaries;
- revocability chosen per vesting at creation: team vestings cancellable, every other category not, enforced by the contract itself;
- positions tied to an account address, never transferable, no NFT;
- continuous linear release (accepted by the team on 2026-10-30); a cliff is a future start date;
- a port of audited, plain-Solidity code with the smallest possible diff, plus a small STRATO-side manager contract that closes the operational gaps without touching the audited file.

Not in scope on this branch: the deploy and schedule-creation script, the backend/UI reads, the audit of the port, and any change to `Token.sol`. Section 10 lists them.

## 2. Why this contract (do not relitigate without the owner)

### 2.1 Provenance

Upstream: https://github.com/safe-fndn/safe-token (formerly `safe-global/safe-token`), `contracts/VestingPool.sol`, author Richard Meissner (@rmeissner), licence **LGPL-3.0-only**. It is the contract Safe used to vest SAFE token allocations. **Verified:**

- 319 lines, one import (the vendored OpenZeppelin `IERC20`), no inline assembly, no other dependency.
- The file was last changed in commit `641907cf69b39805b9b0b6557ef23b005b6e9510` (2022-06-20, "Update comments") and is byte-identical at `main` `886fc7b02de10d57e51bb05b057df2d2f9a7aa49`. Upstream file sha256 `2d48e58104832f4876f3916eff6fa66b5c24075873b59e859c01a3a6fece3b7e`.
- Repository last pushed 2024-08-02; the vesting contract has not changed since June 2022.

### 2.2 What the audits cover

Two independent reviews, both in the upstream `docs/` folder. **Verified** against the commit history:

- **G0 Group, April 2022** (`docs/g0_audit_vesting_contract.pdf`): reviewed the version before the June 2022 refactor.
- **Ackee Blockchain, 23–27 May 2022** (`docs/ackee_audit_vesting_contract.pdf`): one medium finding (the pool manager role) and four informational; fixes delivered 2022-06-23. The commits of 2022-06-17 and 2022-06-20 ("Access vesting info from storage to avoid copying unnecessary information into memory", "Extract update of vesting into internal method", comment fixes) are that fix round, so the code Ackee re-reviewed is the final code and the code this port starts from.

The audits cover EVM semantics. **The port still needs its own audit** for SolidVM behaviour (section 5 lists what was probed and what was not).

### 2.3 Why Safe over the AbdelStark port

Both candidates have working SolidVM ports on this repository. `feature/token-vesting-port` carries abdelhamidbakhta's `TokenVesting` (commit 2fef700) with 12 of 12 tests passing. Safe was chosen on 2026-10-30 for its audit pedigree (two 2022 reviews of the shipped code versus one short 2021 review of a near-identical copy), for pause and resume, and for the smaller deviation list (4 items against 11). AbdelStark keeps the features Safe lacks: slice-period steps, a cliff parameter, per-holder enumeration, an explicit owner withdraw, and the Apache-2.0 licence. With continuous linear release accepted, none of those is required.

## 3. The upstream contract (read this first)

### 3.1 Model

A single pool holds the tokens. A fixed `poolManager` creates vestings; each vesting is a record keyed by a hash of its own parameters and tied to one `account`. Only that account can claim, and it may direct claimed tokens to any beneficiary address. There is no owner withdraw: tokens that are not committed to a vesting are only usable for new vestings.

```solidity
struct Vesting {
    address account;      // who can claim; fixed for life
    uint8   curveType;    // 0 linear, 1 exponential
    bool    managed;      // true: manager may pause/unpause/cancel; false: nobody can
    uint16  durationWeeks;
    uint64  startDate;
    uint128 amount;       // in token atoms
    uint128 amountClaimed;
    uint64  pausingDate;  // 0 when not paused
    bool    cancelled;
}
```

### 3.2 Interface

| Function | Caller | Effect |
|---|---|---|
| `constructor(address _token, address _poolManager)` | deployer | both immutable |
| `addVesting(account, curveType, managed, durationWeeks, startDate, amount)` | manager | requires `tokensAvailableForVesting() >= amount`; id = `vestingHash(...)`; duplicate id rejected |
| `tokensAvailableForVesting()` | view | `balanceOf(this) - totalTokensInVesting` |
| `claimVestedTokens(vestingId, beneficiary, tokensToClaim)` | the vesting's account | pays `min(tokensToClaim, vested - claimed)` to `beneficiary`; `MAX_UINT128` means "all available"; state updated before the transfer |
| `cancelVesting(vestingId)` | manager | managed only; freezes at the current vested amount, returns the rest to the pool's available balance, cannot be undone |
| `pauseVesting(vestingId)` / `unpauseVesting(vestingId)` | manager | managed only; while paused nothing accrues; unpausing shifts `startDate` forward by the paused time |
| `calculateVestedAmount(vestingId)` | view | `(vested, claimed)`; **reverts before `startDate`** ("Vesting not active yet") |
| `vestingHash(account, curveType, managed, durationWeeks, startDate, amount)` | view | EIP-712 hash with domain `(block.chainid, this)` |

Events: `AddedVesting(id, account)`, `ClaimedVesting(id, account, beneficiary)`, `PausedVesting(id)`, `UnpausedVesting(id)`, `CancelledVesting(id)`.

### 3.3 Release arithmetic

`durationSeconds = durationWeeks * 7 * 24 * 60 * 60`. `vestedSeconds = (pausingDate > 0 ? pausingDate : now) - startDate`. If `vestedSeconds >= durationSeconds` everything is vested, otherwise linear: `amount * vestedSeconds / durationSeconds`. Consequences that matter for us:

- A **zero-week vesting is fully vested the moment its start date passes** (`0 >= 0` takes the "everything vested" branch before any division). This is how uncommitted tokens leave the pool (section 7).
- A cliff with nothing unlocked at the cliff is simply a future `startDate`. There is no cliff parameter and none is needed for the sheet.
- Durations are whole weeks. 24 months is 104 weeks (728 days). Do not change the field: it is part of the hashed struct and of the audited math, and 30-day months were never calendar-exact either.
- The `managed` flag is part of the id hash, so it cannot be altered after creation.

## 4. Deviations in the port (D-list)

The port lives at `app/contracts/concrete/Tokenomics/VestingPool.sol`; its header carries the authoritative D-list, reproduced here verbatim. If the two ever differ, the contract header wins and this table must be updated. **Verified:** the body differs from upstream by 17 whitespace-insensitive lines, all of them below.

| # | Deviation (from the contract header) | Why |
|---|---|---|
| D1 | `pragma` dropped (repo convention; the LGPL SPDX line is kept) and the contract declared `record` so Cirrus indexes its state. | SolidVM sources in this repo carry no pragma. The SPDX line stays because LGPL-3.0-only requires the notice on the modified file. `record` exposes `vestings` and `totalTokensInVesting` through Cirrus (`BlockApps-VestingPool` tables) so the backend and UI can read them without RPC calls. |
| D2 | The vendored OpenZeppelin IERC20 import points at the repo's IERC20. | Same interface; the repo's ERC20 reverts on a failed transfer and never returns false, so the upstream `require(transfer(...))` is satisfied the same way. |
| D3 | `type(uint128).max` is not available on SolidVM; its three uses (the claim-all sentinel and the two overflow checks) read the constant MAX_UINT128 instead. | The local CLI rejects `type(T).max` with "Unknown contract: type". The constant is `340282366920938463463374607431768211455`, the same value; callers pass it as the "claim all" sentinel. |
| D4 | The two EIP-712 typehash constants are wrapped in `bytes32(...)`: SolidVM types a bare hex literal as uint and rejects the assignment to bytes32. | Pure typing; the constant values are unchanged, so ids hash identically to upstream for the same inputs on the same chain id. |

Everything else is untouched: every function, require message, event, the struct layout, the EIP-712 id derivation including `block.chainid` and `this`, the `bytes1(0x19)` prefix, the named-field struct literal, the `public immutable` fields, the storage-pointer locals and the named returns all compiled on the local CLI without change.

## 5. SolidVM findings

All established on 2026-10-30 with the local `solid-vm-cli` (build of 2026-03), first on a throwaway copy of the upstream file and then re-run against the port as `app/contracts/tests/Tokenomics/VestingPoolSolidVM.test.sol`. **Verified, 6 of 6 probes pass:**

1. **Ids and creation.** Managed and unmanaged vestings for different accounts get distinct ids; the pool commits the amounts (`totalTokensInVesting`), leaves the remainder available, and rejects a duplicate id with "Vesting id already used".
2. **Claiming.** At 52 of 104 weeks the claim-all sentinel pays exactly 1200 of 2400, `amountClaimed` records 1200 and the committed total drops by 1200. An explicit claim of 100 pays 100. An over-claim fails with "Trying to claim too many tokens" and a stranger fails with "Can only be claimed by vesting owner". At the end the remainder is claimable and the committed total reaches zero. This is the exact shape of the SolidVM call-by-name trap (a named return derived from storage, then the storage is written, then the value is returned and transferred); it did **not** bite here.
3. **Cancel.** Cancelling an unmanaged vesting fails with "Only managed vestings can be cancelled". Cancelling a managed one at 26 of 104 weeks freezes 600 of 2400 as claimable, returns 1800 to the available balance, and the vesting cannot be unpaused afterwards ("Vesting has been cancelled and cannot be unpaused").
4. **Pause.** Paused for 26 weeks, the vested amount stays at 600; after unpausing and another 26 weeks it is 1200, so the start was offset by the paused time.
5. **Zero-week vesting.** An unmanaged zero-week vesting to the treasury address is fully vested immediately and claimable in full. This is the withdraw path and needs no code.
6. **Subclass.** A derived contract can call the inherited internal creator and the hash (which reads `private` constants) on this CLI. This is a test fixture only; the production manager in section 6 is a separate contract, not a subclass.

Not probed and left to the audit: behaviour when the token is paused by its owner mid-claim; `block.chainid` value on helium, upquark and mainnet (ids differ per network by design); arithmetic at amounts near `uint128` max.

**Test-writing quirk, verified:** re-assigning previously destructured tuple locals, `(a, b) = f();`, fails to compile with "Cannot mutate immutable value". Declare fresh names for every destructuring.

## 6. The STRATO-side manager: `VestingPoolManager`

The proposal identified three operational gaps: no batch creation, an immutable `poolManager` that can never be rotated, and "deploy with a multisig as manager", for which STRATO has no primitive. The platform's governance is `AdminRegistry`, reached only through the repo's `Ownable`, whose `onlyOwner` routes a non-owner call into `AdminRegistry.castVoteOnIssue`. The pool's own `onlyPoolManager` is a plain `require`, so `AdminRegistry` cannot drive it directly.

Decision: the pool's manager is a contract, `app/contracts/concrete/Tokenomics/VestingPoolManager.sol` (written alongside this document):

- `contract record VestingPoolManager is Ownable` using the repo's Ownable (constructor takes the initial owner).
- Its constructor deploys the `VestingPool` with itself as `poolManager`, so `pool.poolManager() == address(manager)`.
- Forwards `addVesting`, `cancelVesting`, `pauseVesting`, `unpauseVesting` under `onlyOwner`.
- Adds `addVestings(address[] accounts, uint128[] amounts, bool managed, uint16 durationWeeks, uint64 startDate)`: linear curve, one shape per call, one call per tokenomics category.
- Rotation comes for free through `transferOwnership`.
- Holds no state of its own.

This closes all three gaps with zero edits to the audited file.

**Decision (2026-11-02): the manager's owner is the `AdminRegistry`** (the backend's default genesis address is `000000000000000000000000000000000000100c`; confirm per network). Every create, cancel, pause and ownership change is therefore an admin vote. How the path works, as verified by `VestingPoolManagerGovernance.test.sol` against a real `AdminRegistry` with three admins and the default 60 % threshold:

- An admin votes by calling `AdminRegistry.castVoteOnIssue(manager, "addVestings", typedArgs)` directly, with each argument carrying an explicit Solidity type hint in the registry's variadic slot (`{ type: "address[]", value: [...] }`, `{ type: "uint128[]", value: [...] }` with bare JSON numbers, `bool`, `uint16`, `uint64`), exactly as the app backend's `user.service.ts` (`hintedArg`) does, so the issue id matches what the admin UI computes. **Since 2026-11-09 the helium registry no longer accepts votes routed through a target's onlyOwner fallback**: calling `manager.addVestings` directly as an admin now fails with "Only an admin or a whitelisted account can call castVoteOnIssue". `create-vestings.js` and `whitelist-vesting-pool.js` use the direct form; the manager design is unchanged because the registry still executes the call as the manager's owner at quorum. Below quorum the vote records an issue keyed by the manager address, the function and the typed arguments, and nothing happens on the pool.
- The vote that reaches quorum (2 of 3 here) executes inside its own transaction: the registry calls the manager as owner, the manager forwards to the pool. One of three admins cannot act alone; one of one executes immediately.
- Arguments must be byte-identical across the admins' calls, including `startDate`: a different value is a different issue. Array arguments (`addVestings`) survive the round trip.
- A late vote on an already executed issue opens a new issue; it never re-executes, so a third admin cannot create a duplicate vesting by voting late.
- **If the pool rejects the call at execution time, the quorum vote's transaction reverts with the pool's own message** (verified with "Not enough tokens available" and "Only managed vestings can be cancelled"); nothing is recorded for that vote, earlier votes stand, and once the cause is fixed a single re-vote executes the same issue. The repo Ownable does not swallow these; the earlier concern about silent no-ops does not apply on this path.
- Non-admins are refused by the registry and change nothing.
- `transferOwnership` is itself a vote; after it executes the new owner acts directly and the admins lose control, so treat it as the emergency hand-over, not a routine operation.

## 7. Schedule mapping for the STRATO tokenomics sheet

Total supply 100,000,000 $STRATO. Percentages are the sheet's; exact token counts come from the sheet's "Tokenomics Settings" tab at deployment and are passed in token atoms as `uint128`. `curveType` is 0 everywhere. Durations are whole weeks: 24 months = 104 weeks, 12 months = 52, 6 months = 26, one emission year = 52. `TGE` is the token generation timestamp. "Instant" portions are a plain transfer or a zero-week unmanaged vesting with `startDate = TGE`.

| Category | % | `addVestings` parameters | managed | Notes |
|---|---|---|---|---|
| Team | 14.04 | startDate = TGE + 12 months (e.g. TGE + 365 days), 104 weeks | **true** | the delayed start is the cliff: nothing at month 12, then linear to about month 36; cancellable |
| Advisors | 0.5 | 25 % instant; 75 %: startDate = TGE, 52 weeks | false | two entries per advisor |
| Investors (private sales) | 30.29 | startDate = TGE, 104 weeks | false | one entry per investor |
| Public sale | 5 | outside the pool, instant at TGE | n/a | |
| Airdrop | 5 | outside the pool, instant at TGE | n/a | |
| TVL Deal 1 | 0.9 | 25 % instant; 75 %: startDate = TGE, 26 weeks | false | |
| Ecosystem fund | 15.17 | 50 % instant; 50 %: startDate = TGE, 104 weeks | false | account = treasury |
| Ecosystem development | 6 | startDate = TGE, 104 weeks | false | account = treasury |
| Ongoing TVL rewards | 15.1 | one vesting per year y = 0..9: startDate = TGE + y years, 52 weeks, amount = the sheet's year-(y+1) figure | false | account = rewards distributor; the sheet steps the yearly amount down about 20 % per year |
| Bootstrapping emissions | 8 | same shape as Ongoing TVL, ten vestings | false | account = rewards distributor |

Checks before any creation: `amount > 0` fits `uint128`, the pool already holds `tokensAvailableForVesting() >= amount`, and the `(account, curveType, managed, durationWeeks, startDate, amount)` tuple is unique (two identical grants to the same account need different start dates or amounts). `calculateVestedAmount` and `claimVestedTokens` revert until `startDate`, so a UI must not call them for future vestings.

## 8. Operations runbook

1. **Deploy** with one script, `app/contracts/deploy/deploy-vesting-manager.js`. It flattens the manager, the pool and their imports in memory on every run (the LGPL SPDX line is preserved), writes the result to `vesting-source.txt` for the record, and prints the sha256 of the bytes it submits so every admin can confirm they created identical code. Each admin runs `STRATO_TOKEN=<token address> ADMIN_REGISTRY=<registry address> GLOBAL_ADMIN_NAME=<admin> node deploy-vesting-manager.js` with the usual `NODE_URL`/`OAUTH_*`/`GLOBAL_ADMIN_PASSWORD` environment; `DRY_RUN=1` only writes the artifact and hash. Creation is an AdminRegistry issue, so the run that reaches quorum executes it. The transaction creates two contracts, the pool first (inside the manager's constructor) and then the manager, so the script resolves both through Cirrus (`BlockApps-VestingPool.poolManager`, `BlockApps-VestingPoolManager.pool` and `_owner`) and prints them; do not take the receipt's first created address as the manager. **Helium deployment (2026-11-03):** manager `f9dc9b54279a6d38fedce47288275100c9cb69c0`, pool `1a5ca5bcde1cf38ae2909f04fdb5c3b1f6998a37`, token `8ee9a3391e38176feebf5d43cb2c1d6c4f728b04`, owner `000000000000000000000000000000000000100c`. Token addresses: upquark `2ca3e170e6714282da77815f7864b17f612f5f83`, helium `8ee9a3391e38176feebf5d43cb2c1d6c4f728b04`, mainnet from `app/ui/src/lib/constants.ts`. The registry default is the backend's genesis address `000000000000000000000000000000000000100c`; confirm per network. The flattened artifact was compile-checked on solid-vm-cli (deploys manager + pool, owner and manager wiring correct).
1b. **Whitelist the pool for `transfer` while the token is paused.** The STRATO `Token` carries `whenNotPausedOrOwner` on `transfer`/`transferFrom`: while `_paused` is true (helium today, and mainnet until trading opens), only the token owner or an AdminRegistry-whitelisted caller may transfer. The pool is the caller when a beneficiary claims, so without `AdminRegistry.addWhitelist(token, "transfer", pool)` every claim reverts with "not whitelisted" (found on helium 2026-11-04 on the first claim). Vote it with `STRATO_TOKEN=<token> VESTING_POOL=<pool> node whitelist-vesting-pool.js` (one run per admin, or confirm in the admin UI); check `BlockApps-AdminRegistry-whitelist` for key=token, key2=transfer, key3=pool. Policy note: this lets vested tokens leave the pool while the token is paused, but recipients still cannot transfer onward until the token is unpaused; a zero-week sweep to treasury needs the same entry. Funding transfers into the pool are unaffected (the sender, not the pool, must be allowed).

2. **Fund the pool in step with creation.** Everything above `totalTokensInVesting` is available for new vestings and can be swept out with a zero-week vesting, so do not pre-fund the full 80 M. Funding is a `Token.mint(pool, amount)` vote by an admin (the token's owner is the AdminRegistry). `node create-vestings.js status <schedule.json>` reads the pool's balance and committed total from Cirrus (with `::text` casts, since JSON numbers lose precision at these magnitudes) and prints exactly how many tokens to send for the entries not yet scheduled; `create` refuses to submit while that shortfall is non-zero. The loop is status, send, create, verify.
3. **Create** with `node create-vestings.js create <schedule.json>` (each category is split into batches of `batchSize` entries, default 25, in file order; one `manager.addVestings` transaction per batch, atomic per batch; batches already fully on-chain are skipped and a partially present batch is refused; `create` casts one vote per pending batch, prints the AdminRegistry issue ids, then polls the pool's vestings table until each batch executes, so the flow is admin 1 runs `create`, admin 2 confirms the listed issues in the admin UI, the script reports EXECUTED per batch; `VOTE_WAIT_MINUTES` bounds the wait and re-running later is safe; tune `batchSize` on helium by creating one deliberately large test category and watching the gas limit; `plan` prints every transaction with its arguments and their sha256; `status` matches each entry by account, managed flag, duration, start and amount against the pool's `BlockApps-VestingPool-vestings` table and lists OK/MISSING with the id; `verify` exits 0 only when every entry is scheduled; the file carries one `tge` date, ISO 8601 UTC or unix seconds, and each category a `cliffMonths`, from which the script derives `startDate = TGE + cliffMonths` calendar months in UTC with the day clamped to the shorter month; amounts converted from whole tokens to atoms; `plan` prints the exact arguments and their sha256 so admins compare before voting; `verify` lists the `AddedVesting` id per account afterwards). One run per admin with byte-identical arguments until quorum; the executing admin's transaction either creates every entry of the batch or reverts with the pool's message (section 6). Compute and record each id with `pool.vestingHash(params)`. Verify entries with `pool.calculateVestedAmount(id)` once active (it reverts with "Vesting not found" for an id that was not created) or through Cirrus; do not rely on the `vestings(id)` getter on SolidVM (section 9). Cirrus indexes the `vestings` mapping, the `AddedVesting` events and the registry's issue tables.
4. **Beneficiaries claim** with `pool.claimVestedTokens(id, beneficiary, amount)`; `amount = 340282366920938463463374607431768211455` claims everything available. The claimant may name any beneficiary address.
5. **Revoke a leaver (team only).** `manager.cancelVesting(id)`, voted to quorum. The vested part stays claimable by the leaver; the rest returns to the pool's available balance. Sweep it to treasury with `manager.addVesting(treasury, 0, false, 0, now, amount)` and a claim from the treasury account; use a fresh `startDate` or amount each time because ids are parameter hashes. Confirm the cancel afterwards: `calculateVestedAmount(id)` stops growing, `totalTokensInVesting` dropped by the unvested remainder, and `unpauseVesting(id)` is refused; do not rely on the `vestings(id)` getter (section 9).
6. **Leave of absence.** `manager.pauseVesting(id)` and later `unpauseVesting(id)`; accrual stops while paused and the start date shifts by the paused time.
7. **What this contract cannot promise.** The $STRATO `Token` owner can `burn(address, amount)` and `pause()` any balance, including the pool's. Investor non-revocability is enforced by the pool's `managed == false`, not by the chain. State that in investor documentation.
8. **Licence.** LGPL-3.0-only: keep the SPDX line on the ported file and publish the modified source. The repository is public, which satisfies the obligation; legal should confirm.

## 9. Verification

Test files in `app/contracts/tests/Tokenomics`, run from that directory with `solid-vm-cli test <file>` (CLI at `~/.local/bin/solid-vm-cli`):

- `VestingPoolSolidVM.test.sol`: the six SolidVM probes of section 5 against the port, plus a `BatchPool` subclass fixture.
- `VestingPoolSetup.test.sol`, `VestingPoolHash.test.sol`, `VestingPoolClaim.test.sol`, `VestingPoolManage.test.sol`, `VestingPoolCurves.test.sol`: port of the upstream Hardhat specs (`test/vesting/*.spec.ts`: 10, 4, 11, 20 and 17 upstream cases; the Hash port adds one). Events become state and balance assertions; upstream's exact-hash checks are recomputed in Solidity from the type strings, `block.chainid` and the pool address rather than hardcoded from an EVM chain.
- `VestingPoolManager.test.sol`: forwarding, batch creation, non-owner rejection, ownership rotation (owner = a plain account).
- `VestingPoolManagerGovernance.test.sol`: the manager owned by a real `AdminRegistry` (three admins, 60 % threshold): quorum execution, late votes, batches through the vote path, non-admin refusal, cancel by vote, pool rejection at execution reverting the quorum vote with the pool's message plus recovery by re-vote, single-admin immediate execution, ownership rotation by vote.

**Two SolidVM discrepancies found while porting the suites (contract logic unaffected):**

- **The public struct-mapping getter returns empty values.** `pool.vestings(id)` compiles as a 9-tuple but every field reads back zero or empty on the CLI for an id that `calculateVestedAmount(id)` resolves correctly. Do not rely on `vestings(id)` over RPC; read vesting state through `calculateVestedAmount`, Cirrus (the contract is a `record`), or a reader subclass like the test suite's `InspectablePool`. Whether a live node behaves the same is unverified; treat it as untrusted until checked.
- **Doubly nested revert messages are not delivered as `Error(string)`.** When the token called by the pool reverts with its own message, the caller's frame receives a raw revert that only a generic `catch` matches. The pool's own requires, including "Token transfer failed" when `transfer` returns false, propagate normally.

CLI quirks the suites work around: `type(T).max` is unsupported; `bytes32` hex constants need a `bytes32(...)` cast; re-assigning destructured tuple locals is "Cannot mutate immutable value"; named mapping keys and custom-error `catch` clauses are rejected; with a plain account as owner, a failing `require` inside a repo-`Ownable` body surfaces as a generic revert, so `VestingPoolManager.test.sol` asserts state, not messages; with `AdminRegistry` as owner the pool's message propagates (section 6). `fastForward(seconds)` is the harness clock.

### Results

| File | Date | CLI build | Passed / total | Notes |
|---|---|---|---|---|
| `VestingPoolSolidVM.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 6 / 6 | same six probes passed on the untouched upstream copy first |
| `VestingPoolSetup.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 10 / 10 | upstream Setup spec, case for case |
| `VestingPoolHash.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 5 / 5 | 4 upstream cases + 1 proving the hardcoded typehashes equal keccak of their type strings on SolidVM |
| `VestingPoolClaim.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 11 / 11 | uses an `InspectablePool` reader subclass and a scripted `MockToken` (upstream's MockContract) |
| `VestingPoolManage.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 20 / 20 | pause ×6, unpause ×6, cancel ×8 |
| `VestingPoolCurves.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 17 / 17 | linear and exponential at 10/25/50/66/75/99/100 %, with pauses |
| `VestingPoolManager.test.sol` | 2026-10-30 | solid-vm-cli 2026-03 (local) | 11 / 11 | forwarding, batch, non-owner rejection, rotation, zero-week sweep |
| `VestingPoolManagerGovernance.test.sol` | 2026-11-02 | solid-vm-cli 2026-03 (local) | 8 / 8 | real AdminRegistry votes; pool rejection at execution reverts the quorum vote with the pool's message |

## 10. Open items and follow-ups

- **AdminRegistry address per network** for the manager's constructor (section 6 names the backend default); confirm before deployment.
- **Schedule file for the real sheet**: `app/contracts/deploy/create-vestings.js` (plan / create / status / verify, creation only) exists with `vesting-schedule.example.json` as the template (`tge` + per-category `cliffMonths`, start dates derived; a test-only `secondsPerMonth` override scales cliff months for rehearsals); the production schedule file with the real TGE date, real accounts and the sheet's token counts still has to be written and reviewed. Claiming, pausing, cancelling and funding will live in a management app. Ids are read back from `AddedVesting` events rather than computed off-chain (parity check still open).
- **Audit of the port**: `VestingPool.sol` (SolidVM semantics, section 5's unprobed list) and `VestingPoolManager.sol`. Give the auditor this document, the D-list and the repo's SolidVM semantics notes; EVM auditors will not know the traps.
- **Cirrus reads**: confirm the column shapes of the `vestings` struct mapping and the event tables under the `BlockApps-VestingPool` naming before wiring a page.
- **TGE timestamp**: the sheet still carries a placeholder TGE date (2026-06-30); every `startDate` in section 7 is relative to the real TGE.
- **Upstream hash parity**: for the same inputs and chain id the port's `vestingHash` should equal upstream's; worth one cross-check against an EVM node before relying on off-chain id computation.
