# Port: `TokenVesting` (abdelhamidbakhta) on SolidVM for $STRATO vesting

_Handoff for strato-platform. Written 2026-10-29 on branch `feature/token-vesting-port` from `develop` at 3e6b7749da. Every fact marked **verified** below was checked in the session that produced this branch (source diffs, the audit PDF, and `solid-vm-cli` probes). Decisions marked as questions are open; everything else is final unless the owner reopens it._

## 1. Goal

One vesting contract on STRATO mainnet that holds the locked part of the 100,000,000 $STRATO supply and releases it per the tokenomics sheet ("Tokenomics STRATO draft v2.2s"), with these properties:

- one contract, many schedules, 50+ beneficiaries;
- revocability chosen per schedule at creation: team schedules revocable, every other category not;
- positions tied to a beneficiary address, never transferable, no NFT;
- linear release with a cliff; monthly steps available per schedule but not required (the team accepted continuous release);
- a port of audited, popular, plain-Solidity code with the smallest possible diff.

Not in scope on this branch: the deploy and schedule-creation script, the backend/UI reads, the audit of the port, and any change to `Token.sol`. Section 9 lists them.

## 2. Why this contract and this commit (do not relitigate without the owner)

### 2.1 What was ruled out

Every off-the-shelf vesting product is EVM bytecode; STRATO runs SolidVM, so everything is a port. Against the requirements above:

- Sablier Lockup and Hedgey: every position is an ERC-721, so "no NFT" fails by construction; Sablier is also ~177 KB of Solidity outside interfaces with a BUSL licence.
- OpenZeppelin VestingWallet (v4/v5): one contract per beneficiary, no revocation; v5 is Ownable so the beneficiary can transfer the wallet.
- OpenZeppelin TokenVesting v2.5: revocable flag and immutable beneficiary, but one contract per beneficiary and retired from the library.
- Uniswap TreasuryVester: no revocation, single recipient who can reassign itself, no audit in the repo.
- Safe VestingPool: closest alternative (per-vesting `managed` flag, one pool, Ackee + G0 Group audits) but no slice period and durations in whole weeks.
- MakerDAO DssVest: recipient can `move` an award; governance can always `yank`.
- Lido / Yearn / Curve escrows: Vyper, no port possible. Tokensoft tranche distributors: drag in ERC20Votes.

### 2.2 Why commit 2fef700 and not `main`

Upstream: https://github.com/AbdelStark/token-vesting-contracts (formerly `abdelhamidbakhta`), Apache-2.0, 204 stars / 142 forks at the time of writing.

**Port target: commit `2fef700` (2022-01-10), `contracts/TokenVesting.sol`, 351 lines, Solidity 0.8.5, OpenZeppelin-based.** Verified:

- `main` differs from 2fef700 by 470 changed lines: a rewrite onto solmate on 2023-03-14 and a change to the cliff arithmetic on 2024-04-15 ("fix: Vesting cliff time logic"). None of that was audited.
- solmate's `SafeTransferLib` is inline assembly, which SolidVM cannot run, so `main` also fails the "portable" requirement on its own.
- In 2fef700 accrual counts from `start` and the cliff is a gate (section 3.2). In `main` accrual counts from the cliff. The schedule mapping in section 6 is written for 2fef700; do not mix the two.

### 2.3 What the audit actually covers

The README's "audited by Hacken" badge points at `audits/hacken_audit_report.pdf`. Verified from the PDF:

- It is a Hacken engagement for the customer **ReSource Network**, 2021-10-27 to 2021-11-01, repository `ReSource-Network/ReSource-mono` at commit `5f791e6a474f60d2e60cef6af576f4b11bfb0edf`, scope `ERC20SOUL.sol` and `packages/hardhat/contracts/SOURCE/TokenVesting.sol`. That file credits abdelhamidbakhta as the original author.
- Methods: Mythril, Slither, manual review. Result: no critical, high or medium findings; 2 low findings, of which the one in TokenVesting is a style issue (comparing booleans to `true`).
- The audited copy differs from upstream 2fef700 by 26 whitespace-insensitive lines: the pragma, the header comment, and the `getCurrentTime()` virtual hook (upstream) versus a direct `block.timestamp` read (ReSource).

Conclusion: the audit substantively covers the code being ported, but it is a five-day third-party review of a customer's copy, not a deep audit of this repository. **The port needs its own audit** (section 9), and this document is written so an auditor can start from the deviation table rather than re-deriving it.

## 3. The upstream contract (read this first)

### 3.1 Interface

One owner, one ERC-20, many schedules. Schedule ids are `bytes32`.

| Function | Who | What |
|---|---|---|
| `constructor(address token_)` | deployer | pins the token; owner = deployer |
| `createVestingSchedule(beneficiary, start, cliff, duration, slicePeriodSeconds, revocable, amount)` | owner | one schedule; requires `getWithdrawableAmount() >= amount`, `duration > 0`, `amount > 0`, `slicePeriodSeconds >= 1`; stores `cliff` as `start + cliff` |
| `release(id, amount)` | beneficiary or owner | pays `amount` (≤ releasable) to the beneficiary, never to the caller |
| `revoke(id)` | owner | requires `revocable`; pays what has vested to the beneficiary, then marks revoked; the remainder becomes withdrawable |
| `withdraw(amount)` | owner | transfers to the owner, limited to `getWithdrawableAmount()` = balance − `vestingSchedulesTotalAmount` |
| `computeReleasableAmount(id)` | view | releasable now |
| `getVestingSchedule(id)` | view | the struct |
| `getVestingSchedulesCountByBeneficiary(holder)` | view | number of schedules a holder has |
| `computeVestingScheduleIdForAddressAndIndex(holder, index)` | pure | `keccak256(abi.encodePacked(holder, index))` |
| `computeNextVestingScheduleIdForHolder(holder)` | view | id the next schedule for `holder` will get |
| `getLastVestingScheduleForHolder(holder)` | view | the holder's newest schedule |
| `getVestingIdAtIndex(i)`, `getVestingSchedulesCount()` | view | enumeration of all ids |
| `getVestingSchedulesTotalAmount()`, `getWithdrawableAmount()`, `getToken()` | view | accounting |
| `getCurrentTime()` | internal virtual | `block.timestamp`; tests override it |

Note `createVestingSchedule` in 2fef700 has **no** `duration >= cliff` check (that check exists only in `main`). A cliff longer than the duration is accepted and means nothing before the cliff, everything at once after it.

### 3.2 Release arithmetic (`_computeReleasableAmount`)

```
if now < cliff or revoked:            0
else if now >= start + duration:      amountTotal - released
else:
    timeFromStart   = now - start
    vestedSeconds   = (timeFromStart / slicePeriodSeconds) * slicePeriodSeconds
    vested          = amountTotal * vestedSeconds / duration
    releasable      = vested - released
```

Consequences the schedule mapping relies on:

- Accrual counts from `start`, the cliff only gates. A 12-month cliff on a 36-month duration therefore unlocks 12/36 in one jump at the cliff. A "nothing at the cliff, then linear" shape is expressed as a **delayed start** with `cliff = 0`.
- `slicePeriodSeconds = 1` is continuous (per-second) release; `2592000` (30 days) is monthly steps. Months are 30-day periods, not calendar months.
- `revoke` pays the vested part first, so a revoked beneficiary keeps exactly what had vested at revocation time.
- `withdraw` can never touch tokens committed to live schedules; it can take anything funded but not yet committed.

## 4. Deviations in the port (D-list)

The port lives at `app/contracts/concrete/Tokenomics/TokenVesting.sol`; its header carries the authoritative D-list, reproduced here verbatim with the reasoning an auditor needs. If the two ever differ, the contract header wins and this table must be updated.

| # | Deviation (from the contract header) | Why |
|---|---|---|
| D1 | SPDX and pragma lines dropped (repo convention), contract declared `record` so Cirrus indexes its state. | SolidVM sources in this repo carry neither line. `record` exposes the schedules through Cirrus (`BlockApps-TokenVesting` tables) so the backend and UI can read them without RPC calls. |
| D2 | OpenZeppelin imports replaced by the repo's IERC20, Ownable (AdminRegistry-routed; constructor takes the initial owner, so `Ownable(msg.sender)`) and a verbatim port of OpenZeppelin v4.9 ReentrancyGuard. | The repo's Ownable is how every admin-controlled STRATO contract is governed; see section 5(c) for its behavioural cost and the open question. The repo had no reentrancy guard; OpenZeppelin's is a storage flag and two modifiers, portable as-is (`abstract/ERC20/utils/ReentrancyGuard.sol`). |
| D3 | SafeMath removed: `.add/.sub/.mul/.div` become plain operators. SolidVM reverts on unsigned overflow and underflow, so the checks are preserved. | Same semantics as Solidity ≥ 0.8 checked arithmetic, which upstream already compiled under (0.8.5); the library added nothing but call overhead. |
| D4 | SafeERC20.safeTransfer becomes `require(_token.transfer(...))`. The repo ERC20 reverts on failure and never returns false. | Keeps the upstream intent (a failed transfer aborts the call) without porting SafeERC20's low-level call plumbing. |
| D5 | `receive()` and `fallback()` dropped: STRATO has no native asset. | Upstream had them only to accept ETH. |
| D6 | `payable(beneficiary)` becomes the plain address (no native transfers). | No native currency on STRATO. |
| D7 | The external self-calls `this.getWithdrawableAmount()` and `this.computeNextVestingScheduleIdForHolder(...)` become direct calls. | Both are public views; an external self-call only changes `msg.sender` and adds a call frame. |
| D8 | `computeNextVestingScheduleIdForHolder` packs `holdersVestingCount[holder] + 0`. SolidVM encodes a never-written storage value as ZERO BYTES inside abi.encodePacked, so without `+ 0` every holder's first schedule id would differ from computeVestingScheduleIdForAddressAndIndex(holder, 0). | **The one semantic fix.** Confirmed by probe, section 5(a). |
| D9 | The two upstream events `Released(uint256)` and `Revoked()` were declared but never emitted; they are replaced by VestingScheduleCreated, Released, Revoked and Withdrawn, emitted after the state writes they describe (the VestingScheduleCreated emit precedes the holder-count increment because SolidVM locals are call-by-name and the id is derived from that count). | Cirrus event tables and operators need emitted events. Pure additions; no accounting logic changes. The emit ordering is a SolidVM call-by-name precaution, not a behaviour change. |
| D10 | `view` is written before the modifier on computeReleasableAmount (parser order only). | SolidVM's parser requires the mutability keyword before modifiers. No semantic effect. |
| D11 | `vestingSchedules` is `internal` instead of `private`: the SolidVM CLI resolves inherited function bodies in the derived contract's scope, so a subclass (the test mock that overrides getCurrentTime) could not see it. | Visibility only; `private` is not a security boundary in Solidity. Required for any subclass, including the upstream-style `MockTokenVesting` used by the ported test suite. The same CLI behaviour forced `_nonReentrantBefore/_nonReentrantAfter` to `internal` in the ReentrancyGuard port. |

Everything else, including function names, parameter order, require messages, the modifiers `onlyIfVestingScheduleExists` / `onlyIfVestingScheduleNotRevoked`, and the `VestingSchedule` struct layout, is unchanged from 2fef700 so the audited diff stays reviewable line by line. Note that `createVestingSchedule` keeps upstream 2fef700's checks exactly: it does **not** require `duration >= cliff` (that check exists only in `main`).

## 5. SolidVM findings

All three were established on 2026-10-29 with the local `solid-vm-cli` (build of 2026-03) using a minimal replica of the upstream release/revoke/id code shape; the same checks now run against the real port in `TokenVestingSolidVM.test.sol` (section 8).

**(a) CONFIRMED: packed id of a holder's first schedule.** `keccak256(abi.encodePacked(holder, holdersVestingCount[holder]))` evaluated for a holder that has no schedule yet gives a different hash from `keccak256(abi.encodePacked(holder, uint256(0)))`. `holdersVestingCount[holder] + 0` gives the literal-form hash. Without D8, every beneficiary's first schedule would be stored under an id that `computeVestingScheduleIdForAddressAndIndex(holder, 0)` and `getLastVestingScheduleForHolder(holder)` cannot reproduce, so a UI computing ids would find nothing, and `release` by computed id would fail the `initialized` check. The schedule would still be reachable through `getVestingIdAtIndex`, which returns the stored id. This is the general SolidVM behaviour recorded in `solid-vm/src/Blockchain/SolidVM/Builtins.hs` (`encodeValuePacked` drops unmaterialised values) and already bit `ValidatorRegistry.operatorAuthorizationDigest`.

**(b) VERIFIED SAFE: the release/revoke shape.** SolidVM locals are call-by-name, and `revoke` computes `vestedAmount` from storage, calls `release(id, vestedAmount)` which writes `released` and `vestingSchedulesTotalAmount`, then transfers. The probe reproduced exactly this shape: after `revoke` at 25 % elapsed, the beneficiary balance equalled the vested amount and the locked total was zero. Storage-pointer locals (`VestingSchedule storage s = ...`) also behave; `YieldVault.sol` already relies on them.

**(c) The repo `Ownable` swallows body failures.** Its `onlyOwner` wraps `_checkOwner(); _;` in a block-form `try`; when anything inside the body throws, the `catch` calls `AdminRegistry(owner()).castVoteOnIssue(sender, msg.sig, msg.data)` and returns. Effects for this contract:

- A failing `require` inside `createVestingSchedule`, `revoke` or `withdraw` does not surface its message. With an EOA or multisig owner the vote call hits a non-contract and the transaction fails anyway; with `AdminRegistry` as owner it may succeed as a no-op vote.
- Every owner-only body in this contract checks before it writes, so no partial state is left behind (block-form `try` does not roll back writes in SolidVM).
- Operators and tests must assert state (schedule fields, balances) rather than rely on revert messages for owner-only calls.

**Open question (owner decides):** keep the repo `Ownable` so that `AdminRegistry` governance applies to `revoke` and `withdraw`, or port the plain OpenZeppelin `Ownable` and set a multisig as owner for clean reverts. The port uses the repo `Ownable` (D2); switching is a one-import change plus the constructor argument.

## 6. Schedule mapping for the STRATO tokenomics sheet

Total supply 100,000,000 $STRATO. Amounts below are the sheet's percentages; the exact token counts come from the sheet (`Tokenomics Settings` tab) at deployment. "Month" means 30 days (2,592,000 s). `TGE` is the token generation timestamp. `slicePeriodSeconds` is `1` throughout (continuous release, accepted by the team); use `2592000` instead if monthly steps are wanted for a category.

| Category | % | `createVestingSchedule` parameters | revocable | Notes |
|---|---|---|---|---|
| Team | 14.04 | start = TGE + 12 months, cliff = 0, duration = 24 months | **true** | delayed start gives "nothing at month 12, then linear to month 36"; a `cliff = 12 months` on a 36-month duration would instead jump 12/36 at the cliff |
| Advisors | 0.5 | 25 %: a 1-second schedule at TGE (start = TGE, cliff = 0, duration = 1) or a plain transfer; 75 %: start = TGE, cliff = 0, duration = 12 months | false | two schedules per advisor; `getVestingSchedulesCountByBeneficiary` returns 2 |
| Investors (private sales) | 30.29 | start = TGE, cliff = 0, duration = 24 months | false | one schedule per investor |
| Public sale | 5 | outside the contract, instant at TGE | n/a | |
| Airdrop | 5 | outside the contract, instant at TGE | n/a | |
| TVL Deal 1 | 0.9 | 25 % instant (1-second schedule or transfer); 75 %: start = TGE, cliff = 0, duration = 6 months | false | |
| Ecosystem fund | 15.17 | 50 % instant (1-second schedule or transfer); 50 %: start = TGE, cliff = 0, duration = 24 months | false | beneficiary = treasury multisig |
| Ecosystem development | 6 | start = TGE, cliff = 0, duration = 24 months | false | beneficiary = treasury multisig |
| Ongoing TVL rewards | 15.1 | one schedule per year y = 0..9: start = TGE + 12·y months, cliff = 0, duration = 12 months, amount = sheet's year-(y+1) figure | false | beneficiary = rewards distributor; the sheet steps the yearly amount down ~20 % per year |
| Bootstrapping emissions | 8 | same shape as Ongoing TVL, ten schedules | false | beneficiary = rewards distributor |

Checks before creating any schedule: `duration > 0`, `amount > 0`, `slicePeriodSeconds >= 1`, and the contract must already hold at least `getWithdrawableAmount() >= amount` uncommitted tokens.

## 7. Operations runbook

1. **Deploy** `TokenVesting` with the $STRATO `Token` address (upquark: `2ca3e170e6714282da77815f7864b17f612f5f83`; mainnet address from `app/ui/src/lib/constants.ts`). The deployer becomes owner (D2). Transfer ownership to the chosen owner (section 5 open question) before funding.
2. **Fund in step with creation.** `getWithdrawableAmount()` is everything the contract holds that is not committed to a schedule, and the owner can `withdraw` it at any time. Mint or transfer only the amount about to be committed, then create the schedules, then repeat per batch. Do not pre-fund the whole 80 M before schedules exist.
3. **Create schedules.** One `createVestingSchedule` transaction per schedule; there is no batch function. Record the returned id (or recompute it with `computeVestingScheduleIdForAddressAndIndex(holder, index)`, `index` from `getVestingSchedulesCountByBeneficiary(holder)` before creation). Verify each with `getVestingSchedule(id)` after creation because owner-only failures are not loud (section 5c).
4. **Beneficiaries release** with `release(id, amount)`; `amount` ≤ `computeReleasableAmount(id)`. Anyone can look ids up: index `i` of holder `h` is `computeVestingScheduleIdForAddressAndIndex(h, i)`.
5. **Revoke a leaver (team only).** Owner calls `revoke(id)`. The vested part is paid to the beneficiary inside that call; the rest leaves `vestingSchedulesTotalAmount` and becomes withdrawable. Then `withdraw(amount)` to the owner and forward to treasury. `revoke` on a non-revocable schedule does nothing (section 5c), so confirm `getVestingSchedule(id).revoked == true` afterwards.
6. **What this contract cannot promise.** The $STRATO `Token` owner can `burn(address, amount)` and `pause()` any balance, including this contract's pool. Investor non-revocability is enforced by this contract's `revocable == false`, not by the chain. State that in investor documentation.

## 8. Verification

Test files in `app/contracts/tests/Tokenomics` at handoff time, run from that directory with `solid-vm-cli test <file>`:

- `TokenVesting.test.sol`: port of the upstream Hardhat suite (`test/TokenVesting.js` at 2fef700), same five cases and names: total supply to owner; vests gradually (create, releasable before cliff is 0, half-way release by beneficiary, stranger cannot release, owner can release, full amount at end); releases vested tokens if revoked; computes the schedule index; input-parameter checks for `createVestingSchedule`.
- `TokenVestingSolidVM.test.sol`: seven SolidVM-specific probes against the real port: first-schedule id for a fresh holder equals the index-0 id (fails on a copy without `+ 0`, verified); release pays the exact amount and reduces the committed total; revoke pays vested, marks revoked and frees the remainder; revoke of a non-revocable schedule leaves every field unchanged; withdraw cannot exceed the uncommitted balance; a 30-day slice period unlocks in steps; the cliff gates and then releases the accrual from start, and a delayed start with zero cliff gives 0 at start and 1/24 after the first month.

The local CLI from 2026-03 rejects named mapping keys (`mapping(address holder => uint256)`) and custom-error `catch` clauses; the port avoids both. `require` failures inside owner-only bodies surface as generic reverts or no-ops (section 5c), so those tests must assert state.

### Results

| File | Date | CLI build | Passed / total | Notes |
|---|---|---|---|---|
| `TokenVesting.test.sol` | 2026-10-29 | solid-vm-cli 2026-03 (local) | 5 / 5 | upstream cases; owner-only failures asserted by state |
| `TokenVestingSolidVM.test.sol` | 2026-10-29 | solid-vm-cli 2026-03 (local) | 7 / 7 | negative control for D8 run on a throwaway copy |

## 9. Open items and follow-ups

- **Deploy and schedule-creation script**: not written. It should read the sheet-derived amounts, mint/transfer per batch, call `createVestingSchedule` once per row of section 6, and verify each schedule (step 3 of the runbook).
- **Audit of the port**: required (section 2.3). Give the auditor this document, the D-list, and the SolidVM semantics notes in the repo; EVM auditors will not know the traps in section 5.
- **Ownable decision** (section 5c): repo `Ownable` with `AdminRegistry` governance, or plain `Ownable` with a multisig.
- **Slice period**: `1` (continuous, accepted) or `2592000` (30-day steps) per category.
- **Backend/UI reads**: with `contract record` the schedules are visible through Cirrus under the `BlockApps-TokenVesting` naming convention; confirm column shapes for the struct mapping before wiring a page.
- **TGE timestamp**: the sheet still carries a placeholder TGE date (2026-06-30); every `start` in section 6 is relative to the real TGE.
