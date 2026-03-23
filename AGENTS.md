## Learned User Preferences

- Prefer the simplest possible approach; keep code lean and minimal; never touch files outside the task scope; prefer stepwise implementation for multi-step work
- Do not over-explain or repeat analysis already provided; answer the actual question directly
- "Clean lean clinical" is the standard: no redundancy, no dead code, no unnecessary abstractions; extract large presentational blocks into separate components when files grow big
- Self-review every diff line before presenting; never modify existing comments, formatting, or unrelated code; preserve step-flow comments and section headers during refactors
- When asked to "figure it out yourself," read env files and configs autonomously; always test endpoints with real auth tokens from `.env`; call Cirrus/backend endpoints with `curl` to verify data before claiming things work
- Put interfaces, types, and constants in canonical locations (types file, config index) not inline in service files; avoid creating new files when an existing one is the right home
- Helper functions should only build params and parse results -- all Cirrus/API calls belong in the service layer
- Ask for approval before making design-level decisions (e.g., sum vs max for bonus percentages); when asked to push, push only the specific files requested
- Remove debug logs immediately after confirming a fix; reuse existing constants (e.g. WAD) instead of redefining locally
- Always trace through to the actual backend code (service, contract calls) before assuming fees, data shapes, or tx costs from frontend constants alone
- PR descriptions should be short summaries (2-3 bullets), not long write-ups; never mention Cursor or AI tools in PRs/issues
- Follow mockups closely; match layout, styling, and behavior exactly; when user says "like the mockup" they mean pixel-level fidelity
- Tab switches use true crossfades (both panels rendered, opacity toggle); network/data switches should NOT animate -- just swap data in place; skeleton loaders only for genuinely async first-loads, never for cached data; data must be ready before animation starts
- Avoid unnecessary `useEffect`; prefer derived state, event handlers, or `useMemo` over effects; user explicitly dislikes effect-heavy code

## Learned Workspace Facts

- STRATO network IDs exceed JS `Number.MAX_SAFE_INTEGER`; must guard with `Number.isSafeInteger()` before passing to viem/wagmi; MetaMask crashes on oversized chain IDs (`initProvider` → `numberToHex`)
- Backend config is fetched from STRATO node metadata at startup (`/eth/v1.2/metadata`); `NODE_URL` determines which network (upquark mainnet vs helium testnet)
- STRATO tx fee is 0.01 USDST per contract call; parallel batches cost 0.01 * N; use `computeMaxTransferable` to deduct fees from max amount
- Bridge-out flow: `bridgeService.confirmWithdrawalBatch` → `safeService.createSafeTransactions` → `safeHelper.createWithdrawalProposals` → `safeHelper.proposeTransactions` (submits to Safe via `apiKit.proposeTransaction`)
- BridgeToken routes: `externalToken` + `stratoToken` + `isDefaultRoute`; default = VIA WRAP, non-default = VIA MINT; `MercataBridge.confirmDeposit` dispatches on `DepositAction` enum (`NONE`, `AUTO_SAVE`, `AUTO_FORGE`); bridge status: 1=Initiated, 2=Pending Review, 3=Completed, 4=Aborted
- Cirrus query optimization: `or=()` to batch filters; phased parallel `Promise.all`; `attributes->>` for selective field extraction in enrichment queries (smaller payload), but full `attributes` blob for data queries (nested JSON is more compact than repeated column names); `history@mapping` for historical data; `authorizeRequest(true)` for public endpoints; multiple `or=` params are ANDed — use `and=(or(...),or(...))` to combine
- Cirrus event table: canonical events (`DepositInitiated`, `WithdrawalRequested`, `MetalMinted`) provide one row per transaction with native `limit`/`offset` pagination; status derived from follow-up events (`DepositCompleted`, `WithdrawalCompleted`, etc.) via batch enrichment; outcome (`AutoForged`, `AutoSaved`) included in same enrichment call; mixed-contract filter: `or=(and(address.eq.{bridge}, event_name.in.(...)), and(address.eq.{forge}, event_name.eq.MetalMinted, attributes->>buyer.neq.{bridge}))`; auto-forge `MetalMinted` events (buyer=bridge) must be excluded from direct metal purchases
- Cirrus `count()` with additional select fields triggers implicit `GROUP BY` (e.g. `select=event_name,count()` returns per-event-name counts); `max()` and `DISTINCT ON` are NOT supported by PostgREST/Cirrus
- Fund page IS BridgeIn page; Buy Metals integrated into BridgeIn.tsx; `tokenCacheRef` caches bridgeable tokens per chainId; `RecentTransactions` is a separate component showing last 5 deposit/withdrawal txns with local-storage optimistic entries
- `UserTokensContext` provides user token balances (auto-fetches from `/tokens/balance` on login); `TokenContext.activeTokens` is admin-only and always `[]` for regular users; refetch `earningAssets` after bridge-in and metals purchases
- MercataBridge requires both `asset.enabled` and `Token.status == ACTIVE` for deposits/withdrawals; Token.sol `burn()` is `onlyOwner` (TokenFactory); MetalForge `mintMetal` mints to `msg.sender`
- Sidebar nav uses category groupings (TRADE, SPEND, EARN, PRO) defined in `DashboardSidebar.tsx`, `MobileSidebar.tsx`, and `MobileBottomNav.tsx`; all three must stay in sync; Card is under SPEND
- SolidVM contract tests: `solid-vm-cli test <file>` from test dir; pattern is `Describe_*` contract with `beforeAll`/`beforeEach`/`it_*` functions; `fetchMinDepositAmount` depends on both `selectedToken` AND `currentNetwork`/`chainId`
