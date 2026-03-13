## Learned User Preferences

- Prefer the simplest possible approach; keep code lean and minimal
- Do not over-explain or repeat analysis already provided; answer the actual question directly
- When asked to "figure it out yourself," read env files and configs autonomously rather than asking the user
- Put interfaces, types, and constants in canonical locations (types file, config index) not inline in service files
- Avoid creating new files (e.g., constants.ts) when an existing file (e.g., config/index.ts) is the right home; when renaming content, rename the file too
- When asked to push changes, push only the specific files requested -- never include extras
- Ask for approval before making design-level decisions (e.g., sum vs max for bonus percentages)
- Remove debug logs immediately after confirming a fix
- Cursor IDE: primary sidebar on the right side (profile: `-75b6a7f1`)
- When reverting staged changes, only revert files unrelated to the current task
- Use `in.(...)` filter syntax (not `eq.`) for Cirrus queries with multiple addresses
- PR descriptions should be short summaries (2-3 bullets), not long write-ups; never mention Cursor or AI tools in PRs/issues
- Follow mockups closely; match layout, styling, and behavior exactly
- Use skeleton loaders when switching tabs/networks causes content to disappear

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
- Safe API new tiered pricing enforced Feb 24, 2026; existing users must migrate by March 31, 2026 or drop to 2 RPS / 5k calls/month; Growth tier (€199/mo, 1M calls/month, 15 RPS) covers current usage
- Cirrus 503 "No space left on device" errors originate from the remote STRATO node's PostgreSQL shared memory, not the local dev machine
- Prefer batching Cirrus calls: use `in.(...)` on `address`/`collection_name` to fetch from multiple contracts in one `/mapping` call; use Cirrus foreign keys (e.g. `priceOracle_fkey`, `lendingPool_fkey`) to join related data in a single query
- Send data with API responses rather than relying on frontend context being pre-loaded (e.g. oracle prices should come from backend, not depend on OracleContext)
- BridgeToken routes: `externalToken` + `stratoToken` + `isDefaultRoute`; default route = VIA WRAP, non-default = VIA MINT (used for auto-save/auto-forge)
- MetalForge `mintMetal` mints to `msg.sender`; MercataBridge `_autoForge` calls it, then transfers metal to the deposit recipient
- MercataBridge `confirmDeposit` dispatches on `DepositAction` enum (`NONE`, `AUTO_SAVE`, `AUTO_FORGE`) stored via `requestDepositAction`; falls back to direct mint on action failure
- SolidVM contract tests: run `solid-vm-cli test <file>` from test dir; pattern is `Describe_*` contract with `beforeAll`/`beforeEach`/`it_*` functions
