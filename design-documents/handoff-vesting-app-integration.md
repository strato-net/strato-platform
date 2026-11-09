# Handoff: Vesting tab in the STRATO app (read + claim)

_Written 2026-11-06 for the implementing agent. Branch base: `feature/safe-vesting-pool-port` (contracts, deploy scripts, handoff and livetest docs already on it). Decisions below were made by Hasan; do not reopen them._

## 1. Goal and scope

When the active identity in the app owns at least one vesting in the deployed `VestingPool`, a **Vesting** item appears in the left navigation. Its page shows every vesting the identity owns with the numbers a beneficiary needs, and a **Claim** button per vesting that claims everything currently claimable to the connected address.

Decided:

- Both identities are supported: vault login (OAuth, node-held key) and external wallet (MetaMask or the STRATO wallet extension). The app already routes transactions correctly for each; reuse that path.
- No category labels. Show the on-chain parameters and derived numbers only.
- One claim button per vesting, recipient fixed to the connected address, amount = the contract's claim-all sentinel.
- Reads come from Cirrus through the backend, never from the pool's public getters (see 3.3).
- Everything sits behind a UI feature flag and a backend pool-address setting; where either is missing, the tab does not exist.

Out of scope: anything an admin does (create, pause, cancel, sweep), labels, choosing a recipient, mainnet addresses (contracts are not yet audited).

## 2. Read these first

| File | Why |
|---|---|
| `design-documents/handoff-safe-vesting-pool-port.md` sections 3, 5, 7, 8 | contract semantics, SolidVM quirks, the paused-token whitelist rule |
| `app/contracts/concrete/Tokenomics/VestingPool.sol` | the audited contract: struct, `claimVestedTokens`, `_calculateVestedAmount` |
| `app/backend/src/api/services/staking.service.ts` (`buildAndPost`, `stakingCall`, `claimStratoRewards`) | the exact write pattern to copy |
| `app/backend/src/api/routes/staking.routes.ts`, `controllers/staking.controller.ts` | route and controller shape, `authHandler.authorizeRequest({ allowWalletAuth: true })` |
| `app/backend/src/utils/txHelper.ts` (`postAndWaitForTx`), `txBuilder.ts` (`buildFunctionTx`), `requestContext.ts` | how a wallet identity turns a call into `{ status: "unsigned" }` automatically |
| `app/backend/src/utils/appApiHelper.ts` (`cirrus.get`) | Cirrus client |
| `app/ui/src/lib/axios.ts` | the client signs unsigned transactions with the wallet, submits and polls; nothing to add there |
| `app/ui/src/context/UserContext.tsx` (around lines 309 to 320) | `userAddress` resolution: vault address wins when a session exists, otherwise the wagmi account |
| `app/ui/src/pages/EarnStaking.tsx` (lines 645 to 646 and the `api.post("/staking/claim", ...)` calls) | the `{ walletAuth: true }` config and claim UX |
| `app/ui/src/components/dashboard/DashboardSidebar.tsx`, `MobileSidebar.tsx`, `MobileBottomNav.tsx` | nav item lists, the `adminOnly` filter you will extend |
| `app/ui/src/pages/Rewards.tsx` | a simple data page in the house style (cards, empty state) |
| `app/ui/src/lib/constants.ts` | `rewardsEnabled` flag pattern, `getStratoTokenAddress` per-network map |

## 3. Facts the design depends on

### 3.1 Identity

`VestingPool.claimVestedTokens` pays only when `msg.sender == vesting.account`. The app's resolved `userAddress` (UserContext) is the address that signs: for a vault session the backend signs with the vault key, so `msg.sender` is the vault address; for an external wallet the backend builds an unsigned STRATO call for `req.address` (the `X-Wallet-Address` header), the wallet signs it as EIP-712, the backend submits it, and `msg.sender` is the wallet address. Therefore: look up vestings by `userAddress`, and always claim as that same identity. Addresses are 40-hex, lowercase, no `0x` in the backend (`authHandler` normalises `req.address` that way); Cirrus stores them the same way.

### 3.2 Contract semantics (from the audited source)

- A vesting: `account, curveType (0 linear), managed, durationWeeks, startDate (unix s), amount (uint128 atoms), amountClaimed, pausingDate, cancelled`.
- `durationSeconds = durationWeeks * 604800`. `durationWeeks == 0` means fully vested at `startDate`.
- The cliff is the start date: before it nothing is vested and the contract's view **reverts** with "Vesting not active yet".
- Vested at time `t`: `effective = pausingDate > 0 ? pausingDate : t`; `elapsed = effective - startDate`; `vested = elapsed >= durationSeconds ? amount : floor(amount * elapsed / durationSeconds)`.
- Paused: `pausingDate > 0` and not cancelled; accrual frozen at `pausingDate`. On unpause the contract shifts `startDate` forward by the paused time, so end dates move.
- Cancelled: `cancelled == true`, `pausingDate` holds the cancel time; the vested amount is frozen there and stays claimable; the remainder went back to the pool.
- Claim: `claimVestedTokens(bytes32 vestingId, address beneficiary, uint128 tokensToClaim)`; `tokensToClaim = 340282366920938463463374607431768211455` (max uint128) claims all available. Reverts: "Can only be claimed by vesting owner", "Trying to claim too many tokens", "Cannot claim to 0-address", "Vesting not active yet".
- Every transaction costs 0.01 USDST from the signer, charged even if it reverts. `buildFunctionTx` already runs `ensureFeeCoverage`.

### 3.3 SolidVM and Cirrus quirks you must design around

- The pool's public `vestings(id)` getter returns empty fields over RPC. Do not use it.
- `calculateVestedAmount` reverts before the start date, which is exactly the state the page must display. Compute vested amounts in the backend from the Cirrus row with the formula above.
- Cirrus table `BlockApps-VestingPool-vestings`: one row per vesting with `address` (pool), `key` (the vesting id, 64 hex) and `value` (the struct as a JSON object). Never let `amount` or `amountClaimed` pass through a JavaScript number: fetch the fields as text (`select=key,value->>amount,value->>amountClaimed,...` or `value::text`) or parse the JSON losslessly (quote long digit runs before `JSON.parse`), then convert the strings to `BigInt`. A parsed JSON number has already lost uint128 precision. Filter by pool with `address=eq.<pool>`; filter by account with the PostgREST JSON operator `value->>account=eq.<hex>` and fall back to fetching the pool's rows and filtering in code if that filter is rejected.
- Read large integers from scalar tables with a `::text` cast (`totalTokensInVesting::text`); JSON numbers above 2^53 lose precision.
- In the event tables the event field `id` is shadowed by the row id, so never take vesting ids from events.
- While the STRATO token is paused, a claim fails with "not whitelisted" unless the pool is whitelisted for `transfer`. Helium's pool is whitelisted; mainnet must be before launch. Surface that message verbatim.

### 3.4 Addresses for development (helium)

| | Address |
|---|---|
| VestingPool | `1a5ca5bcde1cf38ae2909f04fdb5c3b1f6998a37` |
| VestingPoolManager | `f9dc9b54279a6d38fedce47288275100c9cb69c0` |
| STRATO token | `8ee9a3391e38176feebf5d43cb2c1d6c4f728b04` |

Five live vestings exist there for Hasan's test accounts (team 229,999 and 2,500.5 managed with a 2-week duration; advisor 10,000 over 1 week; two investors 2,710 and 334,000 at 0 weeks, partly claimed). Ask Hasan which of those accounts you can sign in with for end-to-end testing; the ids are the `key` column of the vestings table.

## 4. Backend

### 4.1 Config

`app/backend/src/config/config.ts`: add `vestingPoolAddress = process.env.VESTING_POOL_ADDRESS || ""` (and optionally `vestingPoolManagerAddress`). Expose `vestingPoolAddress` in `GET /api/config` (`config.controller.ts`) so the UI learns it per deployment. An empty value means the feature is off server-side.

### 4.2 Service `app/backend/src/api/services/vesting.service.ts`

Export pure helpers so they can be unit-tested, following the `earn.service.ts` convention of exporting helpers:

- `computeVestingView(row, nowSeconds)`: takes the parsed struct and returns `{ vestingId, account, managed, durationWeeks, durationSeconds, startDate, endDate, amount, amountClaimed, vested, claimable, locked, status, pausingDate, cancelled, ratePerSecond }`, all big numbers as decimal strings. `status` is one of `not_started`, `vesting`, `paused`, `cancelled`, `fully_vested`, `complete` (complete = cancelled-or-ended with nothing left to claim). `endDate = startDate + durationSeconds` (for a paused vesting show it as "at least" since unpause will push it).
- `getVestingsForAddress(accessToken, address)`: Cirrus read of the pool's rows for that account, mapped through `computeVestingView` with `now = Math.floor(Date.now()/1000)`, plus a `summary` (sums of amount, vested, claimed, claimable, locked). Return `[]` and an empty summary when the pool address is unset.
- `claimVesting(accessToken, userAddress, vestingId)`: load the address's vestings, require the id to be among them (403 otherwise), then exactly the staking pattern: `buildFunctionTx({ contractName: "VestingPool", contractAddress: vestingPoolAddress, method: "claimVestedTokens", args: { vestingId, beneficiary: userAddress, tokensToClaim: MAX_UINT128 } }, userAddress, accessToken)` and `postAndWaitForTx(accessToken, () => strato.post(accessToken, StratoPaths.transactionParallel, builtTx))`. For a wallet identity this returns `{ status: "unsigned", hash }` by itself; the UI client finishes the job. Pass the id as the 64-hex string without `0x` and the beneficiary as 40-hex without `0x`, the way other services pass addresses.

### 4.3 Routes and controller

`app/backend/src/api/routes/vesting.routes.ts`, mounted at `/api/vesting` beside the others:

- `GET /` with `authHandler.authorizeRequest()` → `getVestingsForAddress(req.accessToken, req.address)`; returns `{ pool, vestings, summary }`. Return `{ pool: null, vestings: [], summary }` when unconfigured rather than an error.
- `POST /claim` with `authHandler.authorizeRequest({ allowWalletAuth: true })`, body `{ vestingId }` validated as 64-hex → `claimVesting(...)`; respond with the `{ status, hash }` object unchanged so `axios.ts` can detect `unsigned`.

### 4.4 Tests

`app/backend/src/api/services/vesting.service.test.ts` with `node:test` and `node:assert/strict` (run with `npm test` in `app/backend`; rebuild `app/packages/shared-types` first if tsc reports phantom missing exports). Cover `computeVestingView` for: before start, mid-vesting, exact end, zero-week, paused (frozen at pausingDate), cancelled (frozen, claimable = vested - claimed), fully claimed, and integer flooring against a hand-computed value. Mock `cirrus.get` with `t.mock.method` for `getVestingsForAddress`.

## 5. UI

### 5.1 Flag and config

`app/ui/src/lib/constants.ts`: `export const vestingEnabled = true;` next to `rewardsEnabled`. Read `vestingPoolAddress` from `/api/config` (wherever the app already consumes `networkName`); the tab needs both the flag and a configured pool.

### 5.2 Data hook

`app/ui/src/hooks/useVestings.ts`: react-query, key `["vestings", userAddress]`, `enabled: vestingEnabled && !!userAddress`, `api.get("/vesting")`, `staleTime` about 30 s, refetch on window focus. Expose `hasVesting = vestings.length > 0`. The request must carry the wallet header for guest wallets; `axios.ts` already does that from UserContext's connected wallet address.

### 5.3 Navigation

Add `{ icon: <Hourglass size={20} />, label: 'Vesting', path: '/dashboard/vesting' }` to the EARN group in `DashboardSidebar.tsx` and `MobileSidebar.tsx` (and `MobileBottomNav.tsx` if it lists EARN items). Extend the item model with an optional `visible?: boolean` and extend the existing `adminOnly` filter so an item is shown only when `visible !== false`. Set `visible: hasVesting` from `useVestings()`. The item must never appear for a signed-out user or an identity without rows.

### 5.4 Route and page

Register `/dashboard/vesting` in `App.tsx` inside the dashboard layout, rendering `pages/Vesting.tsx`. The page:

- **Summary card**: total allocated, vested so far, claimed, claimable now, still locked, with STRATO formatted to 18 decimals like other balances in the app.
- **One card per vesting**, newest start first: status badge; amount, claimed, claimable, locked; start date ("Vesting starts" when not started, with a countdown), end date ("at least" while paused); duration in weeks; a progress bar of vested over amount; daily accrual (`amount / durationWeeks / 7`) while vesting; explicit notes when paused ("Accrual is paused since <date>") and cancelled ("Cancelled on <date>; the vested part remains claimable"); the vesting id truncated with copy.
- **Claim button** per vesting: enabled only when `claimable > 0` and status is not `not_started`. On click: `api.post("/vesting/claim", { vestingId }, txConfig)` where `txConfig = isConnected && !isAppAuthenticated ? { walletAuth: true } : undefined` (copy EarnStaking lines 645 to 646). Show the "0.01 USDST fee" note near the button, the signing or submitting progress for wallet users, a success toast with the amount, then `invalidateQueries(["vestings", userAddress])` after a short delay to allow for Cirrus lag, and a balance refresh.
- **Errors**: map the contract messages in 3.2 and "not whitelisted" (explain: the token is paused and the pool is not yet allowed to transfer) to readable text; show everything else from `txFailureMessage` as the app does elsewhere.
- **Dates** in the user's local time with the UTC value in a tooltip.
- Empty state is unreachable through the nav, but render a plain "No vestings for this address" card for direct navigation.

### 5.5 Style

Use the app's design system: semantic tokens only (success, warning, gold variants), the Plex and Bricolage fonts already configured, the hallmark element at most once per view, no raw palette classes. Reuse `Card`, badges, progress and toast primitives from `components/ui`. Match `Rewards.tsx` and `EarnStaking.tsx` for layout density.

### 5.6 Verification

`npm run build` and `npm run lint` in `app/ui` must pass (`npx tsc -b` has about 14 files of pre-existing errors on unrelated pages; compare against the files you touched). Manual checks against helium with `NODE_URL` pointed at `https://app.testnet.strato.nexus` and `VESTING_POOL_ADDRESS` set to the helium pool:

1. Signed out: no tab. Signed in as an account with no vestings: no tab.
2. Signed in as a vested test account (vault) and, separately, connected with a wallet address that has a vesting: tab appears, numbers match the Cirrus row and the formula, status and dates are right for a not-started, a vesting and a fully vested entry.
3. Claim from each identity: the wallet flow prompts an EIP-712 signature, the vault flow does not; the claimed amount lands in the account balance; the card refreshes with `claimed` increased and `claimable` near zero.
4. A claim on a not-started vesting is disabled; a forced one shows "Vesting not active yet".
5. After a Cirrus-visible pause or cancel by the admin, the card shows the state within a minute.

## 6. Acceptance checklist

- [ ] `GET /api/vesting` returns correct computed views for all statuses; unit tests green.
- [ ] `POST /api/vesting/claim` works for vault and wallet identities without new signing code.
- [ ] Tab visibility follows `vestingEnabled`, pool configured, identity has rows.
- [ ] Page numbers reconcile with the Cirrus row and the contract formula to the atom.
- [ ] Claim UX: fee note, progress, success toast, refresh, readable errors.
- [ ] No use of the pool's `vestings(id)` getter or of event-table ids anywhere.
- [ ] Build and lint pass; changes are confined to the files above plus route registration.
