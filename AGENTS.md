## Learned User Preferences

- Prefer the simplest possible approach; keep code lean and minimal; never touch files outside the task scope
- Do not over-explain or repeat analysis already provided; answer the actual question directly
- Self-review every diff line before presenting; never modify existing comments, formatting, or unrelated code
- When asked to "figure it out yourself," read env files and configs autonomously; always test endpoints with real auth tokens from `.env`
- Put interfaces, types, and constants in canonical locations (types file, config index) not inline in service files; avoid creating new files when an existing one is the right home
- When asked to push changes, push only the specific files requested -- never include extras
- Ask for approval before making design-level decisions (e.g., sum vs max for bonus percentages)
- Remove debug logs immediately after confirming a fix
- Cursor IDE: primary sidebar on the right side (profile: `-75b6a7f1`)
- When reverting staged changes, only revert files unrelated to the current task
- Use `in.(...)` filter syntax (not `eq.`) for Cirrus queries with multiple addresses
- PR descriptions should be short summaries (2-3 bullets), not long write-ups; never mention Cursor or AI tools in PRs/issues
- Follow mockups closely; match layout, styling, and behavior exactly
- Transitions must be true crossfades (both states rendered, opacity toggle) so content morphs in place and never disappears; use skeleton loaders only for genuinely async first-loads

## Learned Workspace Facts

- STRATO network IDs exceed JS `Number.MAX_SAFE_INTEGER`; must guard with `Number.isSafeInteger()` before passing to viem/wagmi
- MetaMask connector specifically crashes on oversized chain IDs because `initProvider()` eagerly calls `numberToHex` on all configured chains; Coinbase connector only passes raw IDs at init and defers hex conversion to `switchChain`
- Bridge-out flow: `bridgeService.confirmWithdrawalBatch` -> `safeService.createSafeTransactions` -> `safeHelper.createWithdrawalProposals` -> `safeHelper.proposeTransactions` (submits to Safe via `apiKit.proposeTransaction`)
- Backend config is fetched from STRATO node metadata at startup (`/eth/v1.2/metadata`); `NODE_URL` determines which network (upquark mainnet vs helium testnet)
- `WAGMI_PROJECT_ID` env var is required on backend for WalletConnect; absence causes 400 errors on WalletConnect telemetry but does not block MetaMask extension connections
- Nginx for local dev requires `OAUTH_CLIENT_ID=localhost` (not the domain client) to avoid Keycloak redirect URI errors
- Token.sol `burn()` is `onlyOwner` (TokenFactory); regular token holders cannot burn their own tokens
- MercataBridge requires both `asset.enabled` and `Token.status == ACTIVE` (via `TokenFactory.isTokenActive`) for deposits and withdrawals
- Rewards.sol `sourceContract` is a pure mapping key; registering an address before deployment is safe since the contract is never called
- `mercata/services/rewards-poller` uses atomic JSON file writes (tmp + rename) for state tracking (`lastProcessedBlock.json`, `lastBonusRun.json`)
- OpenAPI doc comments in routes must use quoted YAML strings for descriptions containing `{`, `}`, or `|` characters
- Buy Metals flow is integrated into BridgeIn.tsx (no separate page/route); `BuyMetals.tsx` and `BuyMetalsWidget.tsx` were deleted; `metalForgeService.getConfigs()` returns metals + pay tokens + oracle prices in 2 Cirrus calls
- Cirrus 503 "No space left on device" errors originate from the remote STRATO node's PostgreSQL shared memory, not the local dev machine
- Cirrus query optimization: use `storage` table with `data->>field` selects + `address=in.(...)` for multi-contract state in one call; use `mapping` and `event` tables with `or=()` to combine different filters; use `history@mapping` with `or=()` for batched historical lookups; `authorizeRequest(true)` enables public endpoints with service token fallback
- Send data with API responses rather than relying on frontend context being pre-loaded (e.g. oracle prices should come from backend, not depend on OracleContext)
- BridgeToken routes: `externalToken` + `stratoToken` + `isDefaultRoute`; default route = VIA WRAP, non-default = VIA MINT (used for auto-save/auto-forge)
- MetalForge `mintMetal` mints to `msg.sender`; MercataBridge `_autoForge` calls it, then transfers metal to the deposit recipient
- MercataBridge `confirmDeposit` dispatches on `DepositAction` enum (`NONE`, `AUTO_SAVE`, `AUTO_FORGE`) stored via `requestDepositAction`; falls back to direct mint on action failure
- SolidVM contract tests: run `solid-vm-cli test <file>` from test dir; pattern is `Describe_*` contract with `beforeAll`/`beforeEach`/`it_*` functions
